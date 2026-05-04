/**
 * Sponsored Deposit Functions
 *
 * These functions are modified versions of the Privacy Cash SDK deposit functions
 * that support gas sponsorship by:
 * 1. Removing SOL balance checks (sponsor pays gas)
 * 2. Adding a feePayer parameter to set who pays transaction fees
 *
 * This enables true atomic sponsorship where the sponsor pays gas directly
 * without needing to pre-fund the user.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import * as hasher from "@lightprotocol/hasher.rs";

// Import SDK internals
import { Utxo } from "privacycash/dist/models/utxo.js";
import { Keypair as UtxoKeypair } from "privacycash/dist/models/keypair.js";
import {
  fetchMerkleProof,
  findNullifierPDAs,
  getProgramAccounts,
  queryRemoteTreeState,
  findCrossCheckNullifierPDAs,
  getExtDataHash,
  getMintAddressField,
} from "privacycash/dist/utils/utils.js";
import {
  prove,
  parseProofToBytesArray,
  parseToBytesArray,
} from "privacycash/dist/utils/prover.js";
import { MerkleTree } from "privacycash/dist/utils/merkle_tree.js";
import {
  EncryptionService,
  serializeProofAndExtData,
} from "privacycash/dist/utils/encryption.js";
import { useExistingALT } from "privacycash/dist/utils/address_lookup_table.js";
import { logger } from "privacycash/dist/utils/logger.js";
import {
  FIELD_SIZE,
  FEE_RECIPIENT,
  MERKLE_TREE_DEPTH,
  RELAYER_API_URL,
  PROGRAM_ID,
  ALT_ADDRESS,
  tokens,
  type Token,
} from "privacycash/dist/utils/constants.js";
import { getUtxosSPL } from "privacycash/dist/getUtxosSPL.js";
import { getUtxos } from "privacycash/dist/getUtxos.js";

// Relay function for SPL deposits
async function relayDepositToIndexer({
  signedTransaction,
  publicKey,
  referrer,
  mintAddress,
}: {
  signedTransaction: string;
  publicKey: PublicKey;
  mintAddress: string;
  referrer?: string;
}): Promise<string> {
  logger.debug("Relaying pre-signed deposit transaction to indexer backend...");

  const params: Record<string, string> = {
    signedTransaction,
    senderAddress: publicKey.toString(),
    mintAddress,
  };

  if (referrer) {
    params.referralWalletAddress = referrer;
  }

  const response = await fetch(`${RELAYER_API_URL}/deposit/spl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    logger.debug("res text:", await response.text());
    throw new Error("response not ok");
  }

  const result = (await response.json()) as { signature: string };
  logger.debug("Pre-signed deposit transaction relayed successfully!");
  return result.signature;
}

// Relay function for SOL deposits
async function relaySolDepositToIndexer(
  signedTransaction: string,
  publicKey: PublicKey,
  referrer?: string
): Promise<string> {
  logger.debug("Relaying pre-signed deposit transaction to indexer backend...");

  const params: Record<string, string> = {
    signedTransaction,
    senderAddress: publicKey.toString(),
  };

  if (referrer) {
    params.referralWalletAddress = referrer;
  }

  const response = await fetch(`${RELAYER_API_URL}/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    logger.debug("res text:", await response.text());
    throw new Error("response not ok");
  }

  const result = (await response.json()) as { signature: string };
  logger.debug("Pre-signed deposit transaction relayed successfully!");
  return result.signature;
}

// Check deposit limit
async function checkDepositLimitSPL(
  connection: Connection,
  treeAccount: PublicKey,
  token: Token
): Promise<number | undefined> {
  try {
    const accountInfo = await connection.getAccountInfo(treeAccount);
    if (!accountInfo) {
      console.error("Tree account not found.");
      return;
    }

    const maxDepositAmount = new BN(accountInfo.data.slice(4120, 4128), "le");
    const unitsPerToken = new BN(token.units_per_token);
    const maxDepositSpl = maxDepositAmount.div(unitsPerToken);
    const remainder = maxDepositAmount.mod(unitsPerToken);

    let amountFormatted = "1";
    if (remainder.eq(new BN(0))) {
      amountFormatted = maxDepositSpl.toString();
    } else {
      const fractional = remainder.toNumber() / token.units_per_token;
      amountFormatted = `${maxDepositSpl.toString()}${fractional.toFixed(Math.log10(token.units_per_token)).substring(1)}`;
    }
    return Number(amountFormatted);
  } catch (error) {
    console.log("Error reading deposit limit:", error);
    throw error;
  }
}

async function checkDepositLimitSOL(
  connection: Connection
): Promise<number | undefined> {
  try {
    const [treeAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("merkle_tree")],
      PROGRAM_ID
    );

    const accountInfo = await connection.getAccountInfo(treeAccount);
    if (!accountInfo) {
      console.error("Tree account not found.");
      return;
    }

    const maxDepositAmount = new BN(accountInfo.data.slice(4120, 4128), "le");
    const lamportsPerSol = new BN(1_000_000_000);
    const maxDepositSol = maxDepositAmount.div(lamportsPerSol);
    const remainder = maxDepositAmount.mod(lamportsPerSol);

    let solFormatted = "1";
    if (remainder.eq(new BN(0))) {
      solFormatted = maxDepositSol.toString();
    } else {
      const fractional = remainder.toNumber() / 1e9;
      solFormatted = `${maxDepositSol.toString()}${fractional.toFixed(9).substring(1)}`;
    }
    return Number(solFormatted);
  } catch (error) {
    console.log("Error reading deposit limit:", error);
    throw error;
  }
}

export type SponsoredDepositSPLParams = {
  mintAddress: PublicKey | string;
  publicKey: PublicKey;
  connection: Connection;
  base_units?: number;
  amount?: number;
  storage: Storage;
  encryptionService: EncryptionService;
  keyBasePath: string;
  lightWasm: hasher.LightWasm;
  referrer?: string;
  signer?: PublicKey;
  feePayer?: PublicKey; // Optional: Who pays the transaction fee (defaults to signer)
  additionalInstructions?: TransactionInstruction[]; // NEW: Extra instructions (e.g., sweep)
  transactionSigner: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
};

/**
 * Sponsored SPL Token Deposit
 *
 * Modified version of depositSPL that:
 * - Does NOT check SOL balance (sponsor pays)
 * - Accepts a feePayer parameter
 * - Builds transaction with feePayer as the payer
 */
export async function sponsoredDepositSPL({
  lightWasm,
  storage,
  keyBasePath,
  publicKey,
  connection,
  base_units,
  amount,
  encryptionService,
  transactionSigner,
  referrer,
  mintAddress,
  signer,
  feePayer,
  additionalInstructions = [],
}: SponsoredDepositSPLParams) {
  if (typeof mintAddress === "string") {
    mintAddress = new PublicKey(mintAddress);
  }

  const token = tokens.find((t) => t.pubkey.toString() === mintAddress.toString());
  if (!token) {
    throw new Error("token not found: " + mintAddress.toString());
  }

  if (amount) {
    base_units = amount * token.units_per_token;
  }

  if (!base_units) {
    throw new Error('You must input at least one of "base_units" or "amount"');
  }

  if (!signer) {
    signer = publicKey;
  }

  const recipient = FEE_RECIPIENT;
  const recipient_ata = getAssociatedTokenAddressSync(token.pubkey, recipient, true);
  const feeRecipientTokenAccount = getAssociatedTokenAddressSync(
    token.pubkey,
    FEE_RECIPIENT,
    true
  );
  const signerTokenAccount = getAssociatedTokenAddressSync(token.pubkey, signer);

  // Derive tree account PDA with mint address for SPL
  const [treeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), token.pubkey.toBuffer()],
    PROGRAM_ID
  );

  const limitAmount = await checkDepositLimitSPL(connection, treeAccount, token);
  if (limitAmount && base_units > limitAmount * token.units_per_token) {
    throw new Error(
      `Don't deposit more than ${limitAmount} ${token.name.toUpperCase()}`
    );
  }

  const fee_base_units = 0;
  logger.debug("Encryption key generated from user keypair");
  logger.debug(`User wallet: ${signer.toString()}`);
  logger.debug(
    `Deposit amount: ${base_units} base_units (${base_units / token.units_per_token} ${token.name.toUpperCase()})`
  );

  // Check SPL balance (token balance, not SOL)
  const accountInfo = await getAccount(connection, signerTokenAccount);
  const balance = Number(accountInfo.amount);
  logger.debug(
    `wallet balance: ${balance / token.units_per_token} ${token.name.toUpperCase()}`
  );

  if (balance < base_units + fee_base_units) {
    throw new Error(
      `Insufficient balance. Need at least ${(base_units + fee_base_units) / token.units_per_token} ${token.name.toUpperCase()}.`
    );
  }

  // NOTE: SOL balance check REMOVED - sponsor pays gas

  const { globalConfigAccount } = getProgramAccounts();
  const tree = new MerkleTree(MERKLE_TREE_DEPTH, lightWasm);
  const { root, nextIndex: currentNextIndex } = await queryRemoteTreeState(
    token.name
  );

  logger.debug(`Using tree root: ${root}`);
  logger.debug(
    `New UTXOs will be inserted at indices: ${currentNextIndex} and ${currentNextIndex + 1}`
  );

  const utxoPrivateKey = encryptionService.getUtxoPrivateKeyV2();
  const utxoKeypair = new UtxoKeypair(utxoPrivateKey, lightWasm);
  logger.debug("Using wallet-derived UTXO keypair for deposit");

  logger.debug("\nFetching existing UTXOs...");
  const mintUtxos = await getUtxosSPL({
    connection,
    publicKey,
    encryptionService,
    storage,
    mintAddress,
  });

  let extAmount: number;
  let outputAmount: string;
  let inputs: Utxo[];
  let inputMerklePathIndices: number[];
  let inputMerklePathElements: string[][];

  if (mintUtxos.length === 0) {
    extAmount = base_units;
    outputAmount = new BN(base_units).sub(new BN(fee_base_units)).toString();

    logger.debug(`Fresh deposit scenario (no existing UTXOs):`);
    logger.debug(`External amount (deposit): ${extAmount}`);

    inputs = [
      new Utxo({
        lightWasm,
        keypair: utxoKeypair,
        mintAddress: token.pubkey.toString(),
      }),
      new Utxo({
        lightWasm,
        keypair: utxoKeypair,
        mintAddress: token.pubkey.toString(),
      }),
    ];

    inputMerklePathIndices = inputs.map((input) => input.index || 0);
    inputMerklePathElements = inputs.map(() => [
      ...new Array(tree.levels).fill("0"),
    ]);
  } else {
    const firstUtxo = mintUtxos[0];
    const firstUtxoAmount = firstUtxo.amount;
    const secondUtxoAmount =
      mintUtxos.length > 1 ? mintUtxos[1].amount : new BN(0);
    extAmount = base_units;

    outputAmount = firstUtxoAmount
      .add(secondUtxoAmount)
      .add(new BN(base_units))
      .sub(new BN(fee_base_units))
      .toString();

    logger.debug(`Deposit with consolidation scenario:`);
    logger.debug(`First existing UTXO amount: ${firstUtxoAmount.toString()}`);

    const secondUtxo =
      mintUtxos.length > 1
        ? mintUtxos[1]
        : new Utxo({
            lightWasm,
            keypair: utxoKeypair,
            amount: "0",
            mintAddress: token.pubkey.toString(),
          });

    inputs = [firstUtxo, secondUtxo];

    const firstUtxoCommitment = await firstUtxo.getCommitment();
    const firstUtxoMerkleProof = (
      await fetchMerkleProof([firstUtxoCommitment], token.name)
    ).proofs[0];

    let secondUtxoMerkleProof;
    if (secondUtxo.amount.gt(new BN(0))) {
      const secondUtxoCommitment = await secondUtxo.getCommitment();
      secondUtxoMerkleProof = (
        await fetchMerkleProof([secondUtxoCommitment], token.name)
      ).proofs[0];
    }

    inputMerklePathIndices = [
      firstUtxo.index || 0,
      secondUtxo.amount.gt(new BN(0)) ? secondUtxo.index || 0 : 0,
    ];

    inputMerklePathElements = [
      firstUtxoMerkleProof.pathElements,
      secondUtxo.amount.gt(new BN(0))
        ? secondUtxoMerkleProof!.pathElements
        : [...new Array(tree.levels).fill("0")],
    ];
  }

  const publicAmountForCircuit = new BN(extAmount)
    .sub(new BN(fee_base_units))
    .add(FIELD_SIZE)
    .mod(FIELD_SIZE);

  const outputs = [
    new Utxo({
      lightWasm,
      amount: outputAmount,
      keypair: utxoKeypair,
      index: currentNextIndex,
      mintAddress: token.pubkey.toString(),
    }),
    new Utxo({
      lightWasm,
      amount: "0",
      keypair: utxoKeypair,
      index: currentNextIndex + 1,
      mintAddress: token.pubkey.toString(),
    }),
  ];

  const inputNullifiers = await Promise.all(inputs.map((x) => x.getNullifier()));
  const outputCommitments = await Promise.all(
    outputs.map((x) => x.getCommitment())
  );

  logger.debug("\n=== UTXO VALIDATION ===");
  logger.debug("Output 0 Commitment:", outputCommitments[0]);
  logger.debug("Output 1 Commitment:", outputCommitments[1]);

  logger.debug("\nEncrypting UTXOs with keypair data...");
  const encryptedOutput1 = encryptionService.encryptUtxo(outputs[0]);
  const encryptedOutput2 = encryptionService.encryptUtxo(outputs[1]);

  const extData = {
    recipient: recipient_ata,
    extAmount: new BN(extAmount),
    encryptedOutput1,
    encryptedOutput2,
    fee: new BN(fee_base_units),
    feeRecipient: feeRecipientTokenAccount,
    mintAddress: token.pubkey.toString(),
  };

  const calculatedExtDataHash = getExtDataHash(extData);

  const input = {
    root,
    mintAddress: getMintAddressField(token.pubkey),
    publicAmount: publicAmountForCircuit.toString(),
    extDataHash: calculatedExtDataHash,
    inAmount: inputs.map((x) => x.amount.toString(10)),
    inPrivateKey: inputs.map((x) => x.keypair.privkey),
    inBlinding: inputs.map((x) => x.blinding.toString(10)),
    inPathIndices: inputMerklePathIndices,
    inPathElements: inputMerklePathElements,
    inputNullifier: inputNullifiers,
    outAmount: outputs.map((x) => x.amount.toString(10)),
    outBlinding: outputs.map((x) => x.blinding.toString(10)),
    outPubkey: outputs.map((x) => x.keypair.pubkey),
    outputCommitment: outputCommitments,
  };

  logger.info("generating ZK proof...");
  const { proof, publicSignals } = await prove(input, keyBasePath);
  const proofInBytes = parseProofToBytesArray(proof);
  const inputsInBytes = parseToBytesArray(publicSignals);

  const proofToSubmit = {
    proofA: proofInBytes.proofA,
    proofB: proofInBytes.proofB.flat(),
    proofC: proofInBytes.proofC,
    root: inputsInBytes[0],
    publicAmount: inputsInBytes[1],
    extDataHash: inputsInBytes[2],
    inputNullifiers: [inputsInBytes[3], inputsInBytes[4]],
    outputCommitments: [inputsInBytes[5], inputsInBytes[6]],
  };

  const { nullifier0PDA, nullifier1PDA } = findNullifierPDAs(proofToSubmit);
  const { nullifier2PDA, nullifier3PDA } =
    findCrossCheckNullifierPDAs(proofToSubmit);

  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    PROGRAM_ID
  );
  const treeAta = getAssociatedTokenAddressSync(token.pubkey, globalConfigPda, true);

  const lookupTableAccount = await useExistingALT(connection, ALT_ADDRESS);
  if (!lookupTableAccount?.value) {
    throw new Error(`ALT not found at address ${ALT_ADDRESS.toString()}`);
  }

  const serializedProof = serializeProofAndExtData(proofToSubmit, extData, true);
  logger.debug(`Total instruction data size: ${serializedProof.length} bytes`);

  const depositInstruction = new TransactionInstruction({
    keys: [
      { pubkey: treeAccount, isSigner: false, isWritable: true },
      { pubkey: nullifier0PDA, isSigner: false, isWritable: true },
      { pubkey: nullifier1PDA, isSigner: false, isWritable: true },
      { pubkey: nullifier2PDA, isSigner: false, isWritable: false },
      { pubkey: nullifier3PDA, isSigner: false, isWritable: false },
      { pubkey: globalConfigAccount, isSigner: false, isWritable: false },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: token.pubkey, isSigner: false, isWritable: false },
      { pubkey: signerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: recipient_ata, isSigner: false, isWritable: true },
      { pubkey: treeAta, isSigner: false, isWritable: true },
      { pubkey: feeRecipientTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: serializedProof,
  });

  // Use smaller compute budget to save bytes (500k instead of 1M)
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 500_000,
  });

  const recentBlockhash = await connection.getLatestBlockhash();

  // Build transaction with optional feePayer and additional instructions (e.g., sweep)
  const messageV0 = new TransactionMessage({
    payerKey: feePayer || signer, // Use feePayer if provided, else signer pays
    recentBlockhash: recentBlockhash.blockhash,
    instructions: [modifyComputeUnits, depositInstruction, ...additionalInstructions],
  }).compileToV0Message([lookupTableAccount.value]);

  let versionedTransaction = new VersionedTransaction(messageV0);
  versionedTransaction = await transactionSigner(versionedTransaction);

  logger.debug("Transaction signed");

  const serializedTransaction = Buffer.from(
    versionedTransaction.serialize()
  ).toString("base64");

  logger.info("submitting transaction to relayer...");
  const signature = await relayDepositToIndexer({
    mintAddress: token.pubkey.toString(),
    publicKey: signer,
    signedTransaction: serializedTransaction,
    referrer,
  });

  logger.debug("Transaction signature:", signature);
  logger.debug(`Transaction link: https://explorer.solana.com/tx/${signature}`);

  logger.info("Waiting for transaction confirmation...");

  let retryTimes = 0;
  const itv = 2;
  const encryptedOutputStr = Buffer.from(encryptedOutput1).toString("hex");
  const start = Date.now();

  while (true) {
    logger.info("Confirming transaction..");
    await new Promise((resolve) => setTimeout(resolve, itv * 1000));
    const url = `${RELAYER_API_URL}/utxos/check/${encryptedOutputStr}?token=${token.name}`;
    const res = await fetch(url);
    const resJson = (await res.json()) as { exists: boolean };
    if (resJson.exists) {
      logger.debug(
        `Top up successfully in ${((Date.now() - start) / 1000).toFixed(2)} seconds!`
      );
      return { tx: signature };
    }
    if (retryTimes >= 10) {
      throw new Error("Refresh the page to see latest balance.");
    }
    retryTimes++;
  }
}

export type SponsoredDepositSOLParams = {
  publicKey: PublicKey;
  connection: Connection;
  amount_in_lamports: number;
  storage: Storage;
  encryptionService: EncryptionService;
  keyBasePath: string;
  lightWasm: hasher.LightWasm;
  referrer?: string;
  signer?: PublicKey;
  feePayer: PublicKey; // NEW: Who pays the transaction fee
  transactionSigner: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
};

/**
 * Sponsored SOL Deposit
 *
 * Modified version of deposit that:
 * - Does NOT check SOL balance for gas (sponsor pays)
 * - Only checks that user has enough SOL for the deposit amount
 * - Accepts a feePayer parameter
 * - Builds transaction with feePayer as the payer
 */
export async function sponsoredDepositSOL({
  lightWasm,
  storage,
  keyBasePath,
  publicKey,
  connection,
  amount_in_lamports,
  encryptionService,
  transactionSigner,
  referrer,
  signer,
  feePayer,
}: SponsoredDepositSOLParams) {
  const limitAmount = await checkDepositLimitSOL(connection);

  if (limitAmount && amount_in_lamports > limitAmount * LAMPORTS_PER_SOL) {
    throw new Error(`Don't deposit more than ${limitAmount} SOL`);
  }

  if (!signer) {
    signer = publicKey;
  }

  const fee_amount_in_lamports = 0;
  logger.debug("Encryption key generated from user keypair");
  logger.debug(`User wallet: ${signer.toString()}`);
  logger.debug(
    `Deposit amount: ${amount_in_lamports} lamports (${amount_in_lamports / LAMPORTS_PER_SOL} SOL)`
  );

  // Only check if user has enough SOL for the DEPOSIT (not gas)
  const balance = await connection.getBalance(signer);
  logger.debug(`Wallet balance: ${balance / 1e9} SOL`);

  // NOTE: We only check deposit amount, NOT gas fees (sponsor pays those)
  if (balance < amount_in_lamports) {
    throw new Error(
      `Insufficient balance for deposit: ${balance / 1e9} SOL. Need at least ${amount_in_lamports / LAMPORTS_PER_SOL} SOL to deposit.`
    );
  }

  const { treeAccount, treeTokenAccount, globalConfigAccount } =
    getProgramAccounts();
  const tree = new MerkleTree(MERKLE_TREE_DEPTH, lightWasm);
  const { root, nextIndex: currentNextIndex } = await queryRemoteTreeState();

  logger.debug(`Using tree root: ${root}`);
  logger.debug(
    `New UTXOs will be inserted at indices: ${currentNextIndex} and ${currentNextIndex + 1}`
  );

  const utxoPrivateKey = encryptionService.getUtxoPrivateKeyV2();
  const utxoKeypair = new UtxoKeypair(utxoPrivateKey, lightWasm);
  logger.debug("Using wallet-derived UTXO keypair for deposit");

  logger.debug("\nFetching existing UTXOs...");
  const existingUnspentUtxos = await getUtxos({
    connection,
    publicKey,
    encryptionService,
    storage,
  });

  let extAmount: number;
  let outputAmount: string;
  let inputs: Utxo[];
  let inputMerklePathIndices: number[];
  let inputMerklePathElements: string[][];

  if (existingUnspentUtxos.length === 0) {
    extAmount = amount_in_lamports;
    outputAmount = new BN(amount_in_lamports)
      .sub(new BN(fee_amount_in_lamports))
      .toString();

    logger.debug(`Fresh deposit scenario (no existing UTXOs):`);
    logger.debug(`External amount (deposit): ${extAmount}`);

    inputs = [
      new Utxo({ lightWasm, keypair: utxoKeypair }),
      new Utxo({ lightWasm, keypair: utxoKeypair }),
    ];

    inputMerklePathIndices = inputs.map((input) => input.index || 0);
    inputMerklePathElements = inputs.map(() => [
      ...new Array(tree.levels).fill("0"),
    ]);
  } else {
    const firstUtxo = existingUnspentUtxos[0];
    const firstUtxoAmount = firstUtxo.amount;
    const secondUtxoAmount =
      existingUnspentUtxos.length > 1
        ? existingUnspentUtxos[1].amount
        : new BN(0);
    extAmount = amount_in_lamports;

    outputAmount = firstUtxoAmount
      .add(secondUtxoAmount)
      .add(new BN(amount_in_lamports))
      .sub(new BN(fee_amount_in_lamports))
      .toString();

    logger.debug(`Deposit with consolidation scenario:`);
    logger.debug(`First existing UTXO amount: ${firstUtxoAmount.toString()}`);

    const secondUtxo =
      existingUnspentUtxos.length > 1
        ? existingUnspentUtxos[1]
        : new Utxo({
            lightWasm,
            keypair: utxoKeypair,
            amount: "0",
          });

    inputs = [firstUtxo, secondUtxo];

    const firstUtxoCommitment = await firstUtxo.getCommitment();
    const firstUtxoMerkleProof = (await fetchMerkleProof([firstUtxoCommitment])).proofs[0];

    let secondUtxoMerkleProof;
    if (secondUtxo.amount.gt(new BN(0))) {
      const secondUtxoCommitment = await secondUtxo.getCommitment();
      secondUtxoMerkleProof = (await fetchMerkleProof([secondUtxoCommitment])).proofs[0];
    }

    inputMerklePathIndices = [
      firstUtxo.index || 0,
      secondUtxo.amount.gt(new BN(0)) ? secondUtxo.index || 0 : 0,
    ];

    inputMerklePathElements = [
      firstUtxoMerkleProof.pathElements,
      secondUtxo.amount.gt(new BN(0))
        ? secondUtxoMerkleProof!.pathElements
        : [...new Array(tree.levels).fill("0")],
    ];
  }

  const publicAmountForCircuit = new BN(extAmount)
    .sub(new BN(fee_amount_in_lamports))
    .add(FIELD_SIZE)
    .mod(FIELD_SIZE);

  const outputs = [
    new Utxo({
      lightWasm,
      amount: outputAmount,
      keypair: utxoKeypair,
      index: currentNextIndex,
    }),
    new Utxo({
      lightWasm,
      amount: "0",
      keypair: utxoKeypair,
      index: currentNextIndex + 1,
    }),
  ];

  const inputNullifiers = await Promise.all(inputs.map((x) => x.getNullifier()));
  const outputCommitments = await Promise.all(
    outputs.map((x) => x.getCommitment())
  );

  logger.debug("\n=== UTXO VALIDATION ===");
  logger.debug("Output 0 Commitment:", outputCommitments[0]);
  logger.debug("Output 1 Commitment:", outputCommitments[1]);

  logger.debug("\nEncrypting UTXOs with keypair data...");
  const encryptedOutput1 = encryptionService.encryptUtxo(outputs[0]);
  const encryptedOutput2 = encryptionService.encryptUtxo(outputs[1]);

  const extData = {
    recipient: FEE_RECIPIENT,
    extAmount: new BN(extAmount),
    encryptedOutput1,
    encryptedOutput2,
    fee: new BN(fee_amount_in_lamports),
    feeRecipient: FEE_RECIPIENT,
    mintAddress: inputs[0].mintAddress,
  };

  const calculatedExtDataHash = getExtDataHash(extData);

  const input = {
    root,
    inputNullifier: inputNullifiers,
    outputCommitment: outputCommitments,
    publicAmount: publicAmountForCircuit.toString(),
    extDataHash: calculatedExtDataHash,
    inAmount: inputs.map((x) => x.amount.toString(10)),
    inPrivateKey: inputs.map((x) => x.keypair.privkey),
    inBlinding: inputs.map((x) => x.blinding.toString(10)),
    inPathIndices: inputMerklePathIndices,
    inPathElements: inputMerklePathElements,
    outAmount: outputs.map((x) => x.amount.toString(10)),
    outBlinding: outputs.map((x) => x.blinding.toString(10)),
    outPubkey: outputs.map((x) => x.keypair.pubkey),
    mintAddress: inputs[0].mintAddress,
  };

  logger.info("generating ZK proof...");
  const { proof, publicSignals } = await prove(input, keyBasePath);
  const proofInBytes = parseProofToBytesArray(proof);
  const inputsInBytes = parseToBytesArray(publicSignals);

  const proofToSubmit = {
    proofA: proofInBytes.proofA,
    proofB: proofInBytes.proofB.flat(),
    proofC: proofInBytes.proofC,
    root: inputsInBytes[0],
    publicAmount: inputsInBytes[1],
    extDataHash: inputsInBytes[2],
    inputNullifiers: [inputsInBytes[3], inputsInBytes[4]],
    outputCommitments: [inputsInBytes[5], inputsInBytes[6]],
  };

  const { nullifier0PDA, nullifier1PDA } = findNullifierPDAs(proofToSubmit);
  const { nullifier2PDA, nullifier3PDA } =
    findCrossCheckNullifierPDAs(proofToSubmit);

  logger.debug("Setting up Address Lookup Table...");

  const lookupTableAccount = await useExistingALT(connection, ALT_ADDRESS);
  if (!lookupTableAccount?.value) {
    throw new Error(`ALT not found at address ${ALT_ADDRESS.toString()}`);
  }

  const serializedProof = serializeProofAndExtData(proofToSubmit, extData);
  logger.debug(`Total instruction data size: ${serializedProof.length} bytes`);

  const depositInstruction = new TransactionInstruction({
    keys: [
      { pubkey: treeAccount, isSigner: false, isWritable: true },
      { pubkey: nullifier0PDA, isSigner: false, isWritable: true },
      { pubkey: nullifier1PDA, isSigner: false, isWritable: true },
      { pubkey: nullifier2PDA, isSigner: false, isWritable: false },
      { pubkey: nullifier3PDA, isSigner: false, isWritable: false },
      { pubkey: treeTokenAccount, isSigner: false, isWritable: true },
      { pubkey: globalConfigAccount, isSigner: false, isWritable: false },
      {
        pubkey: FEE_RECIPIENT,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: serializedProof,
  });

  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_000_000,
  });

  const recentBlockhash = await connection.getLatestBlockhash();

  // KEY CHANGE: Use feePayer instead of signer for payerKey
  const messageV0 = new TransactionMessage({
    payerKey: feePayer, // Sponsor pays the fee
    recentBlockhash: recentBlockhash.blockhash,
    instructions: [modifyComputeUnits, depositInstruction],
  }).compileToV0Message([lookupTableAccount.value]);

  let versionedTransaction = new VersionedTransaction(messageV0);
  versionedTransaction = await transactionSigner(versionedTransaction);

  logger.debug("Transaction signed");

  const serializedTransaction = Buffer.from(
    versionedTransaction.serialize()
  ).toString("base64");

  logger.info("submitting transaction to relayer...");
  const signature = await relaySolDepositToIndexer(
    serializedTransaction,
    signer,
    referrer
  );

  logger.debug("Transaction signature:", signature);
  logger.debug(`Transaction link: https://explorer.solana.com/tx/${signature}`);

  logger.info("Waiting for transaction confirmation...");

  let retryTimes = 0;
  const itv = 2;
  const encryptedOutputStr = Buffer.from(encryptedOutput1).toString("hex");
  const start = Date.now();

  while (true) {
    logger.info("Confirming transaction..");
    await new Promise((resolve) => setTimeout(resolve, itv * 1000));
    const res = await fetch(
      `${RELAYER_API_URL}/utxos/check/${encryptedOutputStr}`
    );
    const resJson = (await res.json()) as { exists: boolean };
    if (resJson.exists) {
      logger.debug(
        `Top up successfully in ${((Date.now() - start) / 1000).toFixed(2)} seconds!`
      );
      return { tx: signature };
    }
    if (retryTimes >= 10) {
      throw new Error("Refresh the page to see latest balance.");
    }
    retryTimes++;
  }
}
