/**
 * Deposit Transaction Builder
 *
 * Builds a PrivacyCash deposit transaction WITHOUT submitting.
 * Returns unsigned transaction for batch signing.
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
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import * as path from "path";
import { WasmFactory } from "@lightprotocol/hasher.rs";

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
  PROGRAM_ID,
  ALT_ADDRESS,
  tokens,
} from "privacycash/dist/utils/constants.js";
import { getUtxosSPL } from "privacycash/dist/getUtxosSPL.js";

import { TOKEN_MINTS, TokenType } from "../privacycash/tokens";
import { getCircuitBasePathCached } from "../utils/circuitPath";

export interface BuildDepositParams {
  connection: Connection;
  userKeypair?: Keypair;
  userPublicKey?: PublicKey;
  sessionSignature?: Uint8Array; // 64-byte signature for deriving keys
  baseUnits: number;
  token: TokenType;
  storage: Storage;
  sponsorPublicKey?: PublicKey; // If provided, sponsor pays fees instead of user
}

export interface BuildDepositResult {
  transaction: VersionedTransaction;
  mintAddress: PublicKey;
  encryptedOutput: Uint8Array;
  lastValidBlockHeight: number;
}

/**
 * Build deposit transaction without submitting
 */
export async function buildDepositSPLTransaction(
  params: BuildDepositParams
): Promise<BuildDepositResult> {
  const { connection, userKeypair, userPublicKey: providedPublicKey, sessionSignature, baseUnits, token, storage, sponsorPublicKey } = params;

  // Support both keypair mode (legacy) and session signature mode (new)
  if (!userKeypair && !sessionSignature) {
    throw new Error("Either userKeypair or sessionSignature must be provided");
  }
  if (!userKeypair && !providedPublicKey) {
    throw new Error("userPublicKey is required when using sessionSignature");
  }

  const mintAddress = TOKEN_MINTS[token];
  const userPublicKey = userKeypair?.publicKey ?? providedPublicKey!;

  const tokenInfo = tokens.find((t) => t.pubkey.toString() === mintAddress.toString());
  if (!tokenInfo) {
    throw new Error("Token not found: " + mintAddress.toString());
  }

  // Initialize SDK components
  const lightWasm = await WasmFactory.getInstance();
  const encryptionService = new EncryptionService();

  // Derive encryption keys from either keypair or session signature
  if (userKeypair) {
    encryptionService.deriveEncryptionKeyFromWallet(userKeypair);
  } else {
    encryptionService.deriveEncryptionKeyFromSignature(sessionSignature!);
  }

  // Token accounts
  const recipient = FEE_RECIPIENT;
  const recipient_ata = getAssociatedTokenAddressSync(tokenInfo.pubkey, recipient, true);
  const feeRecipientTokenAccount = getAssociatedTokenAddressSync(
    tokenInfo.pubkey,
    FEE_RECIPIENT,
    true
  );
  const signerTokenAccount = getAssociatedTokenAddressSync(tokenInfo.pubkey, userPublicKey);

  // Tree account PDA
  const [treeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), tokenInfo.pubkey.toBuffer()],
    PROGRAM_ID
  );

  const fee_base_units = 0;

  // Check token balance
  const accountInfo = await getAccount(connection, signerTokenAccount);
  const balance = Number(accountInfo.amount);
  if (balance < baseUnits + fee_base_units) {
    throw new Error(`Insufficient token balance. Need ${baseUnits / tokenInfo.units_per_token} ${tokenInfo.name}`);
  }

  // Get tree state
  const { globalConfigAccount } = getProgramAccounts();
  const tree = new MerkleTree(MERKLE_TREE_DEPTH, lightWasm);
  const { root, nextIndex: currentNextIndex } = await queryRemoteTreeState(tokenInfo.name);

  logger.debug(`Using tree root: ${root}`);
  logger.debug(`Next indices: ${currentNextIndex}, ${currentNextIndex + 1}`);

  // UTXO keypair
  const utxoPrivateKey = encryptionService.getUtxoPrivateKeyV2();
  const utxoKeypair = new UtxoKeypair(utxoPrivateKey, lightWasm);

  // Fetch existing UTXOs
  logger.debug("Fetching existing UTXOs...");
  const mintUtxos = await getUtxosSPL({
    connection,
    publicKey: userPublicKey,
    encryptionService,
    storage,
    mintAddress,
  });

  // Determine inputs and outputs based on existing UTXOs
  let extAmount: number;
  let outputAmount: string;
  let inputs: Utxo[];
  let inputMerklePathIndices: number[];
  let inputMerklePathElements: string[][];

  if (mintUtxos.length === 0) {
    // Fresh deposit
    extAmount = baseUnits;
    outputAmount = new BN(baseUnits).sub(new BN(fee_base_units)).toString();

    inputs = [
      new Utxo({ lightWasm, keypair: utxoKeypair, mintAddress: tokenInfo.pubkey.toString() }),
      new Utxo({ lightWasm, keypair: utxoKeypair, mintAddress: tokenInfo.pubkey.toString() }),
    ];

    inputMerklePathIndices = inputs.map((input) => input.index || 0);
    inputMerklePathElements = inputs.map(() => [...new Array(tree.levels).fill("0")]);
  } else {
    // Consolidation deposit
    const firstUtxo = mintUtxos[0];
    const secondUtxoAmount = mintUtxos.length > 1 ? mintUtxos[1].amount : new BN(0);
    extAmount = baseUnits;

    outputAmount = firstUtxo.amount
      .add(secondUtxoAmount)
      .add(new BN(baseUnits))
      .sub(new BN(fee_base_units))
      .toString();

    const secondUtxo = mintUtxos.length > 1
      ? mintUtxos[1]
      : new Utxo({ lightWasm, keypair: utxoKeypair, amount: "0", mintAddress: tokenInfo.pubkey.toString() });

    inputs = [firstUtxo, secondUtxo];

    const firstUtxoCommitment = await firstUtxo.getCommitment();
    const firstUtxoMerkleProof = (await fetchMerkleProof([firstUtxoCommitment], tokenInfo.name)).proofs[0];

    let secondUtxoMerkleProof;
    if (secondUtxo.amount.gt(new BN(0))) {
      const secondUtxoCommitment = await secondUtxo.getCommitment();
      secondUtxoMerkleProof = (await fetchMerkleProof([secondUtxoCommitment], tokenInfo.name)).proofs[0];
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

  // Build outputs
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
      mintAddress: tokenInfo.pubkey.toString(),
    }),
    new Utxo({
      lightWasm,
      amount: "0",
      keypair: utxoKeypair,
      index: currentNextIndex + 1,
      mintAddress: tokenInfo.pubkey.toString(),
    }),
  ];

  const inputNullifiers = await Promise.all(inputs.map((x) => x.getNullifier()));
  const outputCommitments = await Promise.all(outputs.map((x) => x.getCommitment()));

  // Encrypt outputs
  const encryptedOutput1 = encryptionService.encryptUtxo(outputs[0]);
  const encryptedOutput2 = encryptionService.encryptUtxo(outputs[1]);

  const extData = {
    recipient: recipient_ata,
    extAmount: new BN(extAmount),
    encryptedOutput1,
    encryptedOutput2,
    fee: new BN(fee_base_units),
    feeRecipient: feeRecipientTokenAccount,
    mintAddress: tokenInfo.pubkey.toString(),
  };

  const calculatedExtDataHash = getExtDataHash(extData);

  // Build proof input
  const input = {
    root,
    mintAddress: getMintAddressField(tokenInfo.pubkey),
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

  // Generate ZK proof
  logger.info("generating ZK proof...");
  const keyBasePath = getCircuitBasePathCached();
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

  // Find PDAs
  const { nullifier0PDA, nullifier1PDA } = findNullifierPDAs(proofToSubmit);
  const { nullifier2PDA, nullifier3PDA } = findCrossCheckNullifierPDAs(proofToSubmit);

  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    PROGRAM_ID
  );
  const treeAta = getAssociatedTokenAddressSync(tokenInfo.pubkey, globalConfigPda, true);

  // Get ALT
  const lookupTableAccount = await useExistingALT(connection, ALT_ADDRESS);
  if (!lookupTableAccount?.value) {
    throw new Error(`ALT not found at ${ALT_ADDRESS.toString()}`);
  }

  // Serialize proof
  const serializedProof = serializeProofAndExtData(proofToSubmit, extData, true);
  logger.debug(`Instruction data size: ${serializedProof.length} bytes`);

  // Build deposit instruction
  const depositInstruction = new TransactionInstruction({
    keys: [
      { pubkey: treeAccount, isSigner: false, isWritable: true },
      { pubkey: nullifier0PDA, isSigner: false, isWritable: true },
      { pubkey: nullifier1PDA, isSigner: false, isWritable: true },
      { pubkey: nullifier2PDA, isSigner: false, isWritable: false },
      { pubkey: nullifier3PDA, isSigner: false, isWritable: false },
      { pubkey: globalConfigAccount, isSigner: false, isWritable: false },
      { pubkey: userPublicKey, isSigner: true, isWritable: true },
      { pubkey: tokenInfo.pubkey, isSigner: false, isWritable: false },
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

  // Compute budget
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 500_000,
  });

  // Build transaction - use "confirmed" for fresher blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  // Use sponsor as fee payer if provided, otherwise user pays
  const feePayerKey = sponsorPublicKey ?? userPublicKey;

  const messageV0 = new TransactionMessage({
    payerKey: feePayerKey,
    recentBlockhash: blockhash,
    instructions: [modifyComputeUnits, depositInstruction],
  }).compileToV0Message([lookupTableAccount.value]);

  const transaction = new VersionedTransaction(messageV0);

  return {
    transaction,
    mintAddress: tokenInfo.pubkey,
    encryptedOutput: encryptedOutput1,
    lastValidBlockHeight,
  };
}
