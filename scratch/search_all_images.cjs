const postgres = require("c:/Users/tduy2/OneDrive/ドキュメント/project/erp/packages/server/node_modules/postgres");
const DATABASE_URL = "postgres://postgres:postgres@localhost:5432/erp_local";

async function main() {
  const sql = postgres(DATABASE_URL);
  
  // Get all tables and columns of type text/varchar
  const columns = await sql`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND data_type IN ('text', 'character varying', 'user-defined')
      AND table_name NOT LIKE 'pg_%'
      AND table_name NOT LIKE 'sql_%'
    ORDER BY table_name, column_name;
  `;
  
  console.log(`Scanning columns for image files (.jpg, .png, .jpeg)...`);
  
  for (const col of columns) {
    try {
      const query = `
        SELECT "${col.column_name}" 
        FROM "${col.table_name}" 
        WHERE CAST("${col.column_name}" AS text) LIKE '%.jpg%'
           OR CAST("${col.column_name}" AS text) LIKE '%.png%'
           OR CAST("${col.column_name}" AS text) LIKE '%.jpeg%'
        LIMIT 5;
      `;
      const res = await sql.unsafe(query);
      if (res.length > 0) {
        console.log(`FOUND IN: table "${col.table_name}", column "${col.column_name}"`);
        console.log(JSON.stringify(res, null, 2));
      }
    } catch (e) {
      // Ignore errors for system tables/views or incompatible columns
    }
  }
  
  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
