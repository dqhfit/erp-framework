const postgres = require("c:/Users/tduy2/OneDrive/ドキュメント/project/erp/packages/server/node_modules/postgres");
const DATABASE_URL = "postgres://postgres:postgres@localhost:5432/erp_local";

async function main() {
  const sql = postgres(DATABASE_URL);
  
  const result = await sql`
    SELECT f_phanloai, COUNT(*) as count 
    FROM tr_banve
    GROUP BY f_phanloai
    ORDER BY count DESC;
  `;
  
  console.log("DISTINCT PHANLOAI IN tr_banve:", JSON.stringify(result, null, 2));
  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
