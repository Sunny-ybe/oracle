// Gift-card redemptions recorded on Solana devnet (D-032).
// reserved → (points taken once) → pending (signature saved, sent) → awaiting_fulfillment (confirmed on chain) → fulfilled (by hand)
// A failed or expired transaction becomes "failed": the points stay held, and the person can retry (a new transaction,
// only after the old one can no longer land) or cancel (points back, once). The memo holds only an opaque ID.
import { randomBytes, createPublicKey, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import * as mongo from "../db/mongo.js";
import * as solana from "./solana.js";
import { REWARDS } from "../config.js";

let notify = () => {};
/** server.js passes the live-event emitter so the dashboard can show redemptions. */
export const onRedemptionEvent = (fn) => { notify = fn; };

// The parts that talk to Solana. Tests swap these to simulate failures without touching devnet.
const chain = {
  enabled: () => solana.solanaEnabled(),
  sign: (text) => solana.signMemo(text),
  send: (raw) => solana.sendRaw(raw),
  confirm: (tx) => solana.confirmSignature(tx),
  state: (sig, lvbh) => solana.signatureState(sig, lvbh),
};
export const _chainForTests = chain;

const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");

/** What the app sees. Never includes the user's name, codes or keys. */
export function view(r) {
  if (!r) return null;
  return {
    id: r._id, rewardId: r.rewardId, reward: r.reward, points: r.points, status: r.status,
    signature: r.signature || null, explorerUrl: r.signature ? solana.explorerTx(r.signature) : null,
    wallet: r.wallet ? { kind: r.wallet.kind, address: short(r.wallet.address) } : null,
    createdAt: r.createdAt, sentAt: r.sentAt || null, confirmedAt: r.confirmedAt || null, fulfilledAt: r.fulfilledAt || null,
    error: r.status === "failed" ? r.error || "The transaction didn't go through." : null,
    canRetry: r.status === "failed", canCancel: r.status === "failed", network: "devnet", fulfillment: "manual",
  };
}

// ---------------------------------------------------------------- wallet ownership

const CHALLENGE_MIN = 10;

export async function walletChallenge(user, address) {
  if (!solana.isValidAddress(address)) throw new Error("That isn't a Solana address.");
  const nonce = randomBytes(16).toString("hex"), issued = new Date();
  const message = [
    "Oracle wants you to verify this Solana wallet.", "",
    `Wallet: ${address}`, `Nonce: ${nonce}`, `Issued: ${issued.toISOString()}`, "",
    "Signing proves you own this wallet. It does not send a transaction, move funds or cost anything.",
    "Oracle will never ask for your seed phrase.",
  ].join("\n");
  await mongo.setWalletChallenge(user._id, { address, nonce, message, expires: new Date(issued.getTime() + CHALLENGE_MIN * 60000) });
  return { message };
}

export async function verifyWallet(user, address, signature) {
  const ch = (await mongo.getUser(user._id))?.walletChallenge;
  if (!ch || ch.address !== address) throw new Error("Start wallet verification again.");
  if (new Date(ch.expires) < new Date()) throw new Error("That request expired. Try again.");
  const sig = Buffer.from(String(signature || ""), "base64");
  if (sig.length !== 64) throw new Error("The wallet didn't return a valid signature.");
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(new PublicKey(address).toBytes()).toString("base64url") }, format: "jwk" });
  if (!verify(null, Buffer.from(ch.message, "utf8"), key, sig)) throw new Error("That signature doesn't match this wallet.");
  await mongo.setVerifiedWallet(user._id, address);
  return { ok: true, address, message: `Wallet ${short(address)} verified.` };
}

export const hasVerifiedWallet = (u) => Boolean(u?.walletVerified && u.walletVerified === u.payoutWallet);

// ---------------------------------------------------------------- redeem

export async function redeem(userId, { rewardId, idemKey, payout = "oracle" } = {}) {
  const reward = REWARDS.find((r) => r.id === rewardId);
  if (!reward) return { ok: false, code: "unknown", message: "Unknown reward." };
  // Older app versions (the current iPhone build) send no key: repeated taps within 15 seconds share one.
  if (!idemKey) idemKey = `legacy-${String(userId).replace(/[^A-Za-z0-9_-]/g, "")}-${rewardId}-${Math.floor(Date.now() / 15000)}`.slice(0, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(idemKey))) return { ok: false, code: "bad_request", message: "Bad request key. Refresh and try again." };

  const earlier = await mongo.redemptionByKey(userId, idemKey);
  if (earlier) return { ok: earlier.status !== "rejected", duplicate: true, redemption: view(earlier), message: "Already requested." };

  const user = await mongo.getUser(userId);
  if (!user) return { ok: false, code: "unknown_user", message: "Sign in again." };
  if (!chain.enabled()) return { ok: false, code: "solana_off", message: "Solana devnet recording isn't switched on for this server." };
  if (payout === "verified" && !hasVerifiedWallet(user)) return { ok: false, code: "wallet", message: "Verify your Solana wallet first, or use your Oracle wallet." };
  if ((user.credits || 0) < reward.points) return { ok: false, code: "insufficient", message: `${reward.name} needs ${reward.points} points. You have ${user.credits || 0}.` };

  const wallet = payout === "verified" ? { kind: "verified", address: user.payoutWallet } : { kind: "oracle", address: user.wallet?.pub };
  const id = `rdm_${randomBytes(9).toString("base64url")}`;
  const made = await mongo.createRedemption({
    _id: id, userId, idemKey, rewardId: reward.id, reward: reward.name, points: reward.points, wallet,
    name: user.name, channel: user.channel, status: "reserved", createdAt: new Date(), attempts: [],
  });
  if (made.duplicate) return { ok: made.duplicate.status !== "rejected", duplicate: true, redemption: view(made.duplicate), message: "Already requested." };

  // The backend decides: points are taken atomically, once per redemption ID.
  if (!(await mongo.deductForRedemption(userId, id, reward.points))) {
    await mongo.updateRedemption(id, { status: "rejected", error: "Not enough points." });
    return { ok: false, code: "insufficient", redemption: view(await mongo.getRedemption(id)), message: `${reward.name} needs ${reward.points} points.` };
  }
  notify("redeem", { name: user.name, reward: reward.name, points: reward.points });
  // Answer within ~20 s; if devnet is slow the app keeps polling and the reconciler finishes the job.
  await Promise.race([record(id), new Promise((r) => setTimeout(r, 20000))]);
  const r = await mongo.getRedemption(id);
  return { ok: true, redemption: view(r), message: statusMessage(r) };
}

function statusMessage(r) {
  if (r.status === "awaiting_fulfillment") return `Recorded on Solana devnet. Your ${r.reward} is awaiting manual fulfillment.`;
  if (r.status === "failed") return "The Solana transaction didn't go through. Your points are held: retry, or cancel to get them back.";
  return "Recording on Solana devnet…";
}

/** Sends one memo transaction for a redemption. Only one caller at a time can claim it. */
async function record(id) {
  const claimed = await mongo.moveRedemption(id, ["reserved", "failed"], { status: "signing" }, { $unset: { error: "" } });
  if (!claimed) return;
  let tx = null;
  try {
    tx = await chain.sign(solana.redemptionMemo(id));
    await mongo.updateRedemption(id, { status: "pending", signature: tx.signature, blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, sentAt: new Date() },
      { $push: { attempts: { signature: tx.signature, at: new Date() } } });
    await chain.send(tx.raw);
    const state = await chain.confirm(tx);
    if (state === "confirmed") await confirmed(id);
    else await mongo.moveRedemption(id, ["pending"], { status: "failed", error: state === "expired" ? "The transaction expired before it was confirmed." : "The transaction failed on Solana." });
  } catch (e) {
    // It may have landed anyway (for example a timeout after sending). Check before calling it failed.
    let state = "failed";
    if (tx) { try { state = await chain.state(tx.signature, tx.lastValidBlockHeight); } catch { state = "pending"; } }
    if (state === "confirmed") await confirmed(id);
    else if (state === "pending") { /* still in flight: the reconciler settles it */ }
    else await mongo.moveRedemption(id, ["signing", "pending"], { status: "failed", error: `The transaction didn't go through (${String(e.message).slice(0, 120)}).` });
  }
}

async function confirmed(id) {
  const r = await mongo.moveRedemption(id, ["pending", "signing", "failed"], { status: "awaiting_fulfillment", confirmedAt: new Date() });
  if (r) notify("redeemed", { reward: r.reward, url: solana.explorerTx(r.signature) });
}

/** Retry a failed redemption with a new transaction. Never re-takes points. */
export async function retry(userId, id) {
  const r = await mongo.getRedemption(id);
  if (!r || r.userId !== userId) return { ok: false, message: "Redemption not found." };
  if (r.status !== "failed") return { ok: r.status !== "rejected", redemption: view(r), message: statusMessage(r) };
  // An old transaction that could still land would double-record; only retry once it can't.
  if (r.signature) {
    const state = await chain.state(r.signature, r.lastValidBlockHeight).catch(() => "pending");
    if (state === "confirmed") { await confirmed(id); const done = await mongo.getRedemption(id); return { ok: true, redemption: view(done), message: statusMessage(done) }; }
    if (state === "pending") return { ok: false, redemption: view(r), message: "The last transaction may still land. Try again in a minute." };
  }
  await Promise.race([record(id), new Promise((res) => setTimeout(res, 20000))]);
  const after = await mongo.getRedemption(id);
  return { ok: after.status !== "failed", redemption: view(after), message: statusMessage(after) };
}

/** Cancel a failed redemption: the points come back exactly once. */
export async function cancel(userId, id) {
  const r = await mongo.getRedemption(id);
  if (!r || r.userId !== userId) return { ok: false, message: "Redemption not found." };
  if (r.status !== "failed") return { ok: false, redemption: view(r), message: "Only a failed redemption can be cancelled." };
  if (r.signature) {
    const state = await chain.state(r.signature, r.lastValidBlockHeight).catch(() => "pending");
    if (state === "confirmed") { await confirmed(id); return { ok: false, redemption: view(await mongo.getRedemption(id)), message: "It was recorded after all, so it can't be cancelled." }; }
    if (state === "pending") return { ok: false, redemption: view(r), message: "The last transaction may still land. Try again in a minute." };
  }
  const moved = await mongo.moveRedemption(id, ["failed"], { status: "cancelled", cancelledAt: new Date() });
  if (!moved) return { ok: false, redemption: view(await mongo.getRedemption(id)), message: "Only a failed redemption can be cancelled." };
  const refunded = await mongo.refundForRedemption(userId, id, r.points);
  return { ok: true, refunded, redemption: view(moved), message: refunded ? `Cancelled. ${r.points} points are back.` : "Cancelled." };
}

export const mine = async (userId) => (await mongo.myRedemptions(userId)).map(view);

/** Finishes anything interrupted (server restart, slow devnet). Runs at start and every 30 s. */
export async function reconcile() {
  if (!chain.enabled()) return;
  const stale = new Date(Date.now() - 60000);
  for (const r of await mongo.redemptionsIn(["pending"])) {
    const state = await chain.state(r.signature, r.lastValidBlockHeight).catch(() => "pending");
    if (state === "confirmed") await confirmed(r._id);
    else if (state === "expired" || state === "failed") await mongo.moveRedemption(r._id, ["pending"], { status: "failed", error: "The transaction expired before it was confirmed." });
  }
  for (const r of await mongo.redemptionsIn(["signing"], stale)) {
    await mongo.moveRedemption(r._id, ["signing"], { status: "failed", error: "Recording was interrupted." });
  }
  for (const r of await mongo.redemptionsIn(["reserved"], stale)) {
    if (await mongo.wasDeducted(r.userId, r._id)) record(r._id).catch(() => {});
    else await mongo.moveRedemption(r._id, ["reserved"], { status: "rejected", error: "Not enough points." });
  }
}
