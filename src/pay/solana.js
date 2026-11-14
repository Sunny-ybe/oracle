// Solana devnet: every person gets a wallet; good answers get paid.
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { env } from "../config.js";

const connection = new Connection(env.solanaRpc, "confirmed");
let treasury = null;

export const solanaEnabled = () => Boolean(env.solanaTreasury);
export const explorerTx = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddress = (pub) => `https://explorer.solana.com/address/${pub}?cluster=devnet`;

// Devnet only: the secret is kept so the demo works without anyone installing a wallet app.
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
