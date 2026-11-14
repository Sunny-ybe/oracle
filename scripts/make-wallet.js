// Creates the devnet treasury wallet that pays people.
import { Keypair } from "@solana/web3.js";

const kp = Keypair.generate();
console.log("\nTreasury address (fund this at https://faucet.solana.com, choose Devnet):");
console.log(kp.publicKey.toBase58());
console.log("\nPut this line in .env:");
console.log(`SOLANA_TREASURY_SECRET=${JSON.stringify(Array.from(kp.secretKey))}\n`);
