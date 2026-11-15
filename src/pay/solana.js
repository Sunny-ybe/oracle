// Solana devnet: every person gets a wallet; good answers get paid.
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { env } from "../config.js";

const connection = new Connection(env.solanaRpc, "confirmed");
let treasury = null;

export const solanaEnabled = () => Boolean(env.solanaTreasury);
export const explorerTx = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddress = (pub) => `https://explorer.solana.com/address/${pub}?cluster=devnet`;

// Devnet only: the secret is kept so the demo works without anyone installing a wallet app.
export function isValidAddress(a) {
  try { return PublicKey.isOnCurve(new PublicKey(a).toBytes()); } catch { return false; }
}

export function newWallet() {
  const kp = Keypair.generate();
  return { pub: kp.publicKey.toBase58(), secret: Array.from(kp.secretKey) };
}

function getTreasury() {
  if (!treasury) treasury = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env.solanaTreasury)));
  return treasury;
}

export async function balanceSol(pub) {
  return (await connection.getBalance(new PublicKey(pub))) / LAMPORTS_PER_SOL;
}

// Payments go out one at a time so they never collide.
let chain = Promise.resolve();
export function pay(toPub, sol) {
  const job = chain.then(async () => {
    const from = getTreasury();
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: new PublicKey(toPub),
        lamports: Math.round(sol * LAMPORTS_PER_SOL),
      })
    );
    const signature = await sendAndConfirmTransaction(connection, tx, [from]);
    return { signature, url: explorerTx(signature) };
  });
  chain = job.catch(() => {});
  return job;
}

export async function treasuryInfo() {
  if (!solanaEnabled()) return null;
  const pub = getTreasury().publicKey.toBase58();
  return { pub, balance: await balanceSol(pub), url: explorerAddress(pub) };
}

// ---------- redemption records (no token: the standard SPL Memo program) ----------
// The memo holds only an opaque redemption ID. No names, gift-card codes, emails or keys ever go on chain.
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const redemptionMemo = (id) => `oracle:redemption:v1:${id}`;

/** Signs (does not send) a memo transaction from the treasury. The signature is known before sending,
 *  so it can be saved first and a crash or retry never records the same redemption twice unnoticed. */
export async function signMemo(text) {
  const from = getTreasury();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: from.publicKey, blockhash, lastValidBlockHeight }).add(
    new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [{ pubkey: from.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(text, "utf8") })
  );
  tx.sign(from);
  return { signature: bs58encode(tx.signature), raw: tx.serialize(), blockhash, lastValidBlockHeight };
}

export const sendRaw = (raw) => connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 });

/** Waits for confirmation. Resolves "confirmed", "failed" (landed with an error) or "expired" (can never land). */
export async function confirmSignature({ signature, blockhash, lastValidBlockHeight }) {
  try {
    const r = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    return r.value.err ? "failed" : "confirmed";
  } catch (e) {
    if (/block height exceeded|expired/i.test(e.message)) return (await signatureState(signature, lastValidBlockHeight)) === "confirmed" ? "confirmed" : "expired";
    throw e;
  }
}

/** Current state of an earlier signature: "confirmed", "failed", "expired" (blockhash too old to land) or "pending". */
export async function signatureState(signature, lastValidBlockHeight) {
  const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const s = value[0];
  if (s?.err) return "failed";
  if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return "confirmed";
  const height = await connection.getBlockHeight("confirmed");
  return lastValidBlockHeight && height > lastValidBlockHeight ? "expired" : "pending";
}

function bs58encode(bytes) {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex")), out = "";
  while (n > 0n) { out = A[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
  return out;
}
