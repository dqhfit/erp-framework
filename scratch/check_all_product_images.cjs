const postgres = require("c:/Users/tduy2/OneDrive/ドキュメント/project/erp/packages/server/node_modules/postgres");
const DATABASE_URL = "postgres://postgres:postgres@localhost:5432/erp_local";

async function main() {
  const sql = postgres(DATABASE_URL);
  
  // Find products that have images
  const products = await sql`
    SELECT f_masp, f_masp_nhamay, f_hinhanh
    FROM tr_sanpham
    WHERE f_hinhanh IS NOT NULL AND f_hinhanh <> ''
    LIMIT 20;
  `;
  
  console.log(`Found ${products.length} products with images in tr_sanpham.`);
  
  for (const p of products) {
    console.log(`\nProduct masp: ${p.f_masp}, masp_nhamay: ${p.f_masp_nhamay}, image in tr_sanpham: ${p.f_hinhanh}`);
    
    // Check tr_banve
    const banve = await sql`
      SELECT f_filepath, f_pdffile, f_phanloai
      FROM tr_banve
      WHERE f_masp = ${p.f_masp} OR f_masp = ${p.f_masp_nhamay};
    `;
    if (banve.length > 0) {
      console.log(`  - tr_banve:`, JSON.stringify(banve, null, 2));
    }
    
    // Check tr_banve_ai
    const banve_ai = await sql`
      SELECT f_duongdan, f_tenteptin
      FROM tr_banve_ai
      WHERE f_masp = ${p.f_masp} OR f_masp = ${p.f_masp_nhamay};
    `;
    if (banve_ai.length > 0) {
      console.log(`  - tr_banve_ai:`, JSON.stringify(banve_ai, null, 2));
    }
    
    // Check tr_dinhmuc_govan
    const govan = await sql`
      SELECT f_banve, f_hinhanh
      FROM tr_dinhmuc_govan
      WHERE f_masp = ${p.f_masp};
    `;
    if (govan.length > 0) {
      console.log(`  - tr_dinhmuc_govan:`, JSON.stringify(govan, null, 2));
    }
  }
  
  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
