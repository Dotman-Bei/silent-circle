import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const KEYGEN_PDA = new PublicKey("FuPeXXSGtm6VdcRGRqrVFEMSWERJd52uKm9jeGrMz9mD");
const info = await conn.getAccountInfo(KEYGEN_PDA);
if (!info) { console.log("CLOSED — keygen computation account was deleted (may have completed or failed)"); process.exit(0); }
const d = info.data;
console.log("Length:", d.length, "bytes");
console.log("Owner:", info.owner.toBase58());
console.log("Discriminator:", Buffer.from(d.slice(0, 8)).toString("hex"));
console.log("Bytes[8..16]:", Buffer.from(d.slice(8, 16)).toString("hex"));
console.log("Bytes[16..48]:", Buffer.from(d.slice(16, 48)).toString("hex"));
console.log("Full hex:", Buffer.from(d).toString("hex"));
