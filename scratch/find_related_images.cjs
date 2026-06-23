const postgres = require("c:/Users/tduy2/OneDrive/ドキュメント/project/erp/packages/server/node_modules/postgres");
const DATABASE_URL = "postgres://postgres:postgres@localhost:5432/erp_local";

async function main() {
  const sql = postgres(DATABASE_URL);
  
  // Find all tables and their columns
  const columns = await sql`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name NOT LIKE 'pg_%'
      AND table_name NOT LIKE 'sql_%'
    ORDER BY table_name, column_name;
  `;
  
  // Group columns by table
  const tableCols = {};
  for (const c of columns) {
    if (!tableCols[c.table_name]) {
      tableCols[c.table_name] = [];
    }
    tableCols[c.table_name].push(c.column_name);
  }
  
  console.log("Searching tables for masp '1500217400-002_002_MAX' or masp_nhamay '1500217400-002' that contain images...");
  
  for (const [table, cols] of Object.entries(tableCols)) {
    const maspCol = cols.find(c => c === "f_masp" || c === "f_masp_nhamay" || c === "f_masp_khachhang");
    if (!maspCol) continue;
    
    // Look for columns that might hold files/images
    const fileCols = cols.filter(c => 
      c.includes("hinh") || 
      c.includes("img") || 
      c.includes("image") || 
      c.includes("file") || 
      c.includes("path") ||
      c.includes("banve") ||
      c.includes("teptin") ||
      c.includes("ext")
    );
    
    if (fileCols.length === 0) continue;
    
    try {
      const query = `
        SELECT "${maspCol}", ${fileCols.map(c => `"${c}"`).join(", ")}
        FROM "${table}"
        WHERE "${maspCol}" IN ('1500217400-002_002_MAX', '1500217400-002', '181214-01-002_002_MAX', '181214-01-002')
        LIMIT 5;
      `;
      const res = await sql.unsafe(query);
      if (res.length > 0) {
        console.log(`\nTABLE: ${table} (matched by ${maspCol})`);
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
