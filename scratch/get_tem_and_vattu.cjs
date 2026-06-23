const postgres = require("c:/Users/tduy2/OneDrive/ドキュメント/project/erp/packages/server/node_modules/postgres");
const DATABASE_URL = "postgres://postgres:postgres@localhost:5432/erp_local";

async function main() {
  const sql = postgres(DATABASE_URL);
  
  console.log("Checking tr_sanpham_tem...");
  const tem = await sql`
    SELECT * 
    FROM tr_sanpham_tem 
    LIMIT 2;
  `;
  console.log("TEM:", JSON.stringify(tem, null, 2));

  console.log("Checking tr_sanpham_vattu...");
  const vattu = await sql`
    SELECT * 
    FROM tr_sanpham_vattu 
    LIMIT 2;
  `;
  console.log("VATTU:", JSON.stringify(vattu, null, 2));

  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
