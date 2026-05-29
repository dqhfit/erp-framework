/* ==========================================================
   parse-proc.test.ts — Test heuristic parser với mẫu T-SQL
   tiêu biểu. Gọi nhớ: parser không đạt 100% chính xác, chỉ
   cần ~80%, human review manifest trước khi sinh code.
   ========================================================== */

import { describe, expect, test } from "vitest";
import {
  analyzeProc,
  stripCommentsAndStrings,
  extractAliasMap,
  extractReads,
  extractWrites,
  extractJoinPairs,
  extractExecCalls,
  detectFlags,
  pickTier,
  extractCteMap,
  extractTempSources,
} from "./parse-proc.js";

describe("stripCommentsAndStrings", () => {
  test("loại bỏ line comment", () => {
    const r = stripCommentsAndStrings("SELECT 1 -- chú thích\nFROM t");
    expect(r).toContain("SELECT 1 ");
    expect(r).toContain("\nFROM t");
    expect(r).not.toContain("chú thích");
  });

  test("loại bỏ block comment", () => {
    const r = stripCommentsAndStrings("SELECT /* xxx */ * FROM t");
    expect(r).not.toContain("xxx");
    expect(r).toContain("SELECT");
    expect(r).toContain("FROM t");
  });

  test("loại bỏ string literal với escape ''", () => {
    const r = stripCommentsAndStrings("SELECT 'O''Brien' AS n FROM t");
    expect(r).not.toContain("Brien");
    expect(r).toContain("SELECT ");
    expect(r).toContain(" AS n FROM t");
  });

  test("string với keyword không gây false positive", () => {
    const r = stripCommentsAndStrings("PRINT 'DELETE FROM huh' SELECT 1");
    const writes = extractWrites(r);
    expect(writes).toEqual([]);
  });
});

describe("extractAliasMap / extractReads", () => {
  test("FROM với alias", () => {
    const sqlText = "SELECT * FROM dbo.Orders AS O JOIN dbo.Customers C ON O.cust_id = C.id";
    const aliases = extractAliasMap(sqlText);
    expect(aliases.get("o")).toBe("dbo.orders");
    expect(aliases.get("c")).toBe("dbo.customers");
    expect(extractReads(sqlText)).toEqual(["dbo.customers", "dbo.orders"]);
  });

  test("bỏ qua temp table và table variable", () => {
    const sqlText = "INSERT INTO #tmp SELECT * FROM @rows JOIN dbo.Real R ON R.id = @rows.id";
    expect(extractReads(sqlText)).toEqual(["dbo.real"]);
    expect(extractWrites(sqlText)).toEqual([]);
  });

  test("bracket và schema thiếu", () => {
    const sqlText = "SELECT * FROM [Sales].[Orders] o";
    expect(extractReads(sqlText)).toEqual(["sales.orders"]);
  });

  test("alias trùng keyword bị loại", () => {
    // "FROM Orders ON" — ON là keyword, không nhận là alias.
    const sqlText = "SELECT * FROM dbo.Orders ON dbo.Items.id = dbo.Orders.id";
    const aliases = extractAliasMap(sqlText);
    expect(aliases.has("on")).toBe(false);
  });
});

describe("extractWrites", () => {
  test("nhận INSERT/UPDATE/DELETE/MERGE", () => {
    const sqlText = `
      INSERT INTO dbo.Orders VALUES (1);
      UPDATE dbo.Customers SET name = 'x' WHERE id = 1;
      DELETE FROM dbo.Logs WHERE ts < '2020-01-01';
      MERGE dbo.Inventory AS t USING ...
    `;
    expect(extractWrites(sqlText).sort()).toEqual([
      "dbo.customers",
      "dbo.inventory",
      "dbo.logs",
      "dbo.orders",
    ]);
  });
});

describe("extractJoinPairs", () => {
  test("ON a.x = b.y với alias resolve", () => {
    const sqlText = `
      SELECT * FROM dbo.Orders O
        JOIN dbo.OrderItems OI ON OI.OrderId = O.Id
        JOIN dbo.Products P ON P.Id = OI.ProductId
    `;
    const aliases = extractAliasMap(sqlText);
    const pairs = extractJoinPairs(sqlText, aliases);
    expect(pairs.length).toBe(2);
    expect(pairs[0]).toMatchObject({
      leftTable: "dbo.orderitems",
      leftColumn: "orderid",
      rightTable: "dbo.orders",
      rightColumn: "id",
    });
    expect(pairs[1]).toMatchObject({
      leftTable: "dbo.products",
      leftColumn: "id",
      rightTable: "dbo.orderitems",
      rightColumn: "productid",
    });
  });
});

describe("extractExecCalls", () => {
  test("EXEC và EXECUTE", () => {
    const sqlText = "EXEC dbo.sp_DoThing 1; EXECUTE sp_Helper @id = 2; EXEC sp_executesql N'...'";
    const calls = extractExecCalls(sqlText);
    expect(calls).toContain("dbo.sp_dothing");
    expect(calls).toContain("dbo.sp_helper");
    expect(calls).not.toContain("dbo.sp_executesql");
  });
});

describe("detectFlags + pickTier", () => {
  test("CRUD đơn giản → tier B, không flag nặng", () => {
    const sqlText = "UPDATE dbo.Orders SET status = 'done' WHERE id = @id";
    const a = analyzeProc(sqlText);
    expect(a.suggestedTier).toBe("B");
    expect(a.flags).not.toContain("has-transaction");
  });

  test("BEGIN TRAN + 2 bảng ghi → tier D", () => {
    const sqlText = `
      BEGIN TRY
        BEGIN TRAN
          INSERT INTO dbo.Orders VALUES (@id);
          UPDATE dbo.Inventory SET qty = qty - 1 WHERE sku = @sku;
        COMMIT TRAN
      END TRY
      BEGIN CATCH ROLLBACK TRAN END CATCH
    `;
    const a = analyzeProc(sqlText);
    expect(a.flags).toContain("has-transaction");
    expect(a.flags).toContain("has-try-catch");
    expect(a.flags).toContain("writes-multi-table");
    expect(a.suggestedTier).toBe("D");
  });

  test("Report với GROUP BY + window → tier D", () => {
    const sqlText = `
      SELECT customer_id, COUNT(*) AS n,
             RANK() OVER (ORDER BY SUM(total) DESC) AS rk
        FROM dbo.Orders
       GROUP BY customer_id
    `;
    const a = analyzeProc(sqlText);
    expect(a.flags).toContain("has-group-by");
    expect(a.flags).toContain("has-window");
    expect(a.suggestedTier).toBe("D");
  });

  test("CTE → tier D", () => {
    const sqlText = `
      WITH q AS (SELECT id FROM dbo.Orders) SELECT * FROM q
    `;
    const a = analyzeProc(sqlText);
    expect(a.flags).toContain("has-cte");
    expect(a.suggestedTier).toBe("D");
  });

  test("Dynamic SQL → tier D", () => {
    const sqlText = "EXEC sp_executesql N'SELECT 1'";
    const a = analyzeProc(sqlText);
    expect(a.flags).toContain("dynamic-sql");
    expect(a.suggestedTier).toBe("D");
  });

  test("pickTier với pure read không flag → B", () => {
    expect(pickTier([], [])).toBe("B");
  });

  test("detectFlags đơn lẻ", () => {
    const f = detectFlags("WHILE 1=1 BEGIN BREAK END", [], []);
    expect(f).toContain("has-while");
  });
});

describe("analyzeProc tổng hợp", () => {
  test("sp_PlaceOrder phức tạp", () => {
    const sqlText = `
      CREATE PROCEDURE dbo.sp_PlaceOrder
        @CustomerId INT, @ProductId INT, @Qty INT
      AS
      BEGIN
        SET NOCOUNT ON;
        BEGIN TRY
          BEGIN TRAN
            DECLARE @OrderId INT;
            INSERT INTO dbo.Orders (customer_id, created_at)
              VALUES (@CustomerId, GETDATE());
            SET @OrderId = SCOPE_IDENTITY();
            INSERT INTO dbo.OrderItems (order_id, product_id, qty)
              VALUES (@OrderId, @ProductId, @Qty);
            UPDATE dbo.Inventory SET qty = qty - @Qty WHERE product_id = @ProductId;
            EXEC dbo.sp_NotifyWarehouse @OrderId;
          COMMIT TRAN
        END TRY
        BEGIN CATCH
          ROLLBACK TRAN;
          THROW;
        END CATCH
      END
    `;
    const a = analyzeProc(sqlText);
    expect(a.writesTables.sort()).toEqual(["dbo.inventory", "dbo.orderitems", "dbo.orders"]);
    expect(a.callsProcs).toContain("dbo.sp_notifywarehouse");
    expect(a.flags).toEqual(
      expect.arrayContaining([
        "has-transaction",
        "has-try-catch",
        "writes-multi-table",
        "calls-other-proc",
      ]),
    );
    expect(a.suggestedTier).toBe("D");
  });
});

describe("extractCteMap", () => {
  test("CTE đơn — trả đúng bảng nguồn", () => {
    const sql = `
      WITH ActiveOrders AS (
        SELECT OrderId, CustomerId FROM dbo.Orders WHERE Status = 'A'
      )
      SELECT c.Name FROM dbo.Customers c JOIN ActiveOrders ao ON c.CustomerId = ao.CustomerId
    `;
    const map = extractCteMap(sql);
    expect(map.get("activeorders")).toEqual(["dbo.orders"]);
  });

  test("CTE nhiều bảng nguồn trong body", () => {
    const sql = `
      WITH Summary AS (
        SELECT O.OrderId, I.Qty FROM dbo.Orders O JOIN dbo.Items I ON O.OrderId = I.OrderId
      )
      SELECT * FROM Summary s JOIN dbo.Customers c ON s.CustomerId = c.CustomerId
    `;
    const map = extractCteMap(sql);
    const sources = map.get("summary") ?? [];
    expect(sources).toContain("dbo.orders");
    expect(sources).toContain("dbo.items");
  });

  test("Multiple CTE", () => {
    const sql = `
      WITH cte1 AS (SELECT id FROM dbo.TableA),
           cte2 AS (SELECT id FROM dbo.TableB)
      SELECT * FROM cte1 JOIN cte2 ON cte1.id = cte2.id
    `;
    const map = extractCteMap(sql);
    expect(map.get("cte1")).toEqual(["dbo.tablea"]);
    expect(map.get("cte2")).toEqual(["dbo.tableb"]);
  });

  test("CTE có column list", () => {
    const sql = `
      WITH cte (col1, col2) AS (SELECT a, b FROM dbo.Source)
      SELECT * FROM cte
    `;
    const map = extractCteMap(sql);
    expect(map.get("cte")).toEqual(["dbo.source"]);
  });

  test("Không có WITH → map rỗng", () => {
    const sql = "SELECT * FROM dbo.A JOIN dbo.B ON A.id = B.id";
    expect(extractCteMap(sql).size).toBe(0);
  });
});

describe("extractTempSources", () => {
  test("SELECT INTO #tmp FROM permanent table", () => {
    const sql = `
      SELECT OrderId, CustomerId INTO #active FROM dbo.Orders WHERE Status = 'A';
    `;
    const map = extractTempSources(sql);
    expect(map.get("#active")).toContain("dbo.orders");
  });

  test("SELECT INTO #tmp với JOIN", () => {
    const sql = `
      SELECT O.OrderId, I.Qty INTO #tmp FROM dbo.Orders O JOIN dbo.Items I ON O.OrderId = I.OrderId;
    `;
    const map = extractTempSources(sql);
    const sources = map.get("#tmp") ?? [];
    expect(sources).toContain("dbo.orders");
    expect(sources).toContain("dbo.items");
  });

  test("INSERT INTO #tmp SELECT FROM", () => {
    const sql = `
      INSERT INTO #result SELECT CustomerId FROM dbo.Customers WHERE Active = 1;
    `;
    const map = extractTempSources(sql);
    expect(map.get("#result")).toContain("dbo.customers");
  });

  test("Không có temp table → map rỗng", () => {
    const sql = "SELECT * FROM dbo.A JOIN dbo.B ON A.id = B.id";
    expect(extractTempSources(sql).size).toBe(0);
  });
});

describe("analyzeProc — trace qua bảng tạm", () => {
  test("CTE: JOIN qua CTE → hint permanent tables", () => {
    const sql = `
      WITH ActiveOrders AS (
        SELECT OrderId, CustomerId FROM dbo.Orders WHERE Status = 'A'
      )
      SELECT c.Name, ao.OrderId
      FROM dbo.Customers c
      JOIN ActiveOrders ao ON c.CustomerId = ao.CustomerId
    `;
    const a = analyzeProc(sql);
    // Phải tìm được hint Customers ↔ Orders qua CTE
    const hasHint = a.joinPairs.some(
      (p) =>
        (p.leftTable === "dbo.customers" && p.rightTable === "dbo.orders") ||
        (p.leftTable === "dbo.orders" && p.rightTable === "dbo.customers"),
    );
    expect(hasHint).toBe(true);
    // via phải ghi lại nguồn CTE
    const indirect = a.joinPairs.find((p) => p.via);
    expect(indirect?.via).toMatch(/^cte:/);
  });

  test("SELECT INTO #tmp rồi JOIN: trace về bảng nguồn", () => {
    const sql = `
      SELECT OrderId, CustomerId INTO #active FROM dbo.Orders WHERE Status = 'A';
      SELECT c.Name, t.OrderId
      FROM dbo.Customers c
      JOIN #active t ON c.CustomerId = t.CustomerId
    `;
    const a = analyzeProc(sql);
    const hasHint = a.joinPairs.some(
      (p) =>
        (p.leftTable === "dbo.customers" && p.rightTable === "dbo.orders") ||
        (p.leftTable === "dbo.orders" && p.rightTable === "dbo.customers"),
    );
    expect(hasHint).toBe(true);
    const indirect = a.joinPairs.find((p) => p.via);
    expect(indirect?.via).toMatch(/^tmp:/);
  });

  test("INSERT INTO #tmp SELECT FROM rồi JOIN", () => {
    const sql = `
      INSERT INTO #ids SELECT CustomerId FROM dbo.Customers WHERE Region = @r;
      SELECT O.* FROM dbo.Orders O JOIN #ids t ON O.CustomerId = t.CustomerId;
    `;
    const a = analyzeProc(sql);
    const hasHint = a.joinPairs.some(
      (p) =>
        (p.leftTable === "dbo.orders" && p.rightTable === "dbo.customers") ||
        (p.leftTable === "dbo.customers" && p.rightTable === "dbo.orders"),
    );
    expect(hasHint).toBe(true);
  });

  test("Direct JOIN vẫn không có via", () => {
    const sql = `
      SELECT * FROM dbo.Orders O JOIN dbo.Customers C ON O.CustomerId = C.CustomerId
    `;
    const a = analyzeProc(sql);
    expect(a.joinPairs.length).toBeGreaterThan(0);
    expect(a.joinPairs.every((p) => !p.via)).toBe(true);
  });

  test("CTE không tạo fake hint đến tên CTE", () => {
    const sql = `
      WITH SummaryAlias AS (SELECT OrderId FROM dbo.Orders)
      SELECT * FROM SummaryAlias s JOIN dbo.Products p ON s.OrderId = p.OrderId
    `;
    const a = analyzeProc(sql);
    // Không được có pair với "dbo.summaryalias"
    const fakePair = a.joinPairs.find(
      (p) => p.leftTable === "dbo.summaryalias" || p.rightTable === "dbo.summaryalias",
    );
    expect(fakePair).toBeUndefined();
  });
});
