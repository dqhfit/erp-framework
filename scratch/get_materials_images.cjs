const postgres = require("c:/Users/tduy2/OneDrive/ドキュメント/project/erp/packages/server/node_modules/postgres");
const DATABASE_URL = "postgres://postgres:postgres@localhost:5432/erp_local";

async function main() {
  const sql = postgres(DATABASE_URL);
  
  console.log("Checking tr_material ext...");
  const mats = await sql`
    SELECT f_mavt, f_tenvt, ext 
    FROM tr_material 
    LIMIT 20;
  `;
  for (const m of mats) {
    if (m.ext && (m.ext.hinhanh || m.ext.hinhanh1)) {
      console.log(`MAT ${m.f_mavt}:`, JSON.stringify(m.ext));
    }
  }

  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
