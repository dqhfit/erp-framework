const postgres = require("c:/Users/tduy2/OneDrive/ドキュメント/project/erp/packages/server/node_modules/postgres");
const DATABASE_URL = "postgres://postgres:postgres@localhost:5432/erp_local";

async function main() {
  const sql = postgres(DATABASE_URL);
  
  const result = await sql`
    SELECT f_masp, f_banve, f_hinhanh
    FROM tr_sanpham
    WHERE f_banve IS NOT NULL AND f_banve <> ''
    LIMIT 20;
  `;
  
  console.log("SANPHAM BANVE:", JSON.stringify(result, null, 2));
  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
