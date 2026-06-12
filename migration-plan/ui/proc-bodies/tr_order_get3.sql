-- PARAMS:
-- @ViewType int
-- @Type nvarchar
-- @IsExample bit
-- @FromDate date
-- @ToDate date

CREATE PROC [dbo].[TR_ORDER_Get3]
(
	@ViewType int = 0,
	@Type nvarchar(50),
	@IsExample bit = 0,
	@FromDate date = NULL,
	@ToDate date = NULL
)
AS
BEGIN
	IF @ViewType = 0
	BEGIN
		IF @Type = 'ALL'
		BEGIN
		   SELECT A.id, A.customer, A.order_number, 
			  A.order_date, A.ship_date, A.etd AS cont_date,
			  A.Finished, A.cust_po_number, A.[range],
			  SUM(B.order_qty) AS order_qty,
			  SUM(B.ship_qty) AS ship_qty,
			  SUM(B.order_qty * B.price) AS amount,
			  MAX(A.create_date) AS create_date,
			  A.create_by,
              A.IsExample, A.IsPhoi, A.IsUV, A.IsOutsource,
              IIF(A.IsExample=1, 'EXAMPLE', IIF(A.IsPhoi=1, 'PHOI', IIF(A.IsUV=1,'UV', IIF(A.IsOutsource=1,'GIACONG', 'SX')))) AS loaidonhang
		   FROM tr_order A
			  LEFT JOIN tr_order_detail B ON A.order_number = B.order_number
		   WHERE A.f_cancelled = 'N' AND B.f_cancelled = 'N'
				AND A.IsExample = @IsExample
		   GROUP BY A.id, A.customer, A.order_number, 
			  A.order_date, A.ship_date, A.etd,
			  A.Finished, A.cust_po_number, A.[range],
			  A.create_by,
              A.IsExample, A.IsPhoi, A.IsUV, A.IsOutsource
		   ORDER BY A.order_date DESC
		END

		IF @Type = 'FINISH'
		BEGIN
		   SELECT A.id, A.customer, A.order_number, 
			  A.order_date, A.ship_date, A.etd AS cont_date,
			  A.Finished, A.cust_po_number, A.[range],
			  SUM(B.order_qty) AS order_qty,
			  SUM(B.ship_qty) AS ship_qty,
			  SUM(B.order_qty * B.price) AS amount,
			  MAX(A.create_date) AS create_date,
			  A.create_by,
              A.IsExample, A.IsPhoi, A.IsUV, A.IsOutsource,
              IIF(A.IsExample=1, 'EXAMPLE', IIF(A.IsPhoi=1, 'PHOI', IIF(A.IsUV=1,'UV', IIF(A.IsOutsource=1,'GIACONG', 'SX')))) AS loaidonhang
		   FROM tr_order A
			  LEFT JOIN tr_order_detail B ON A.order_number = B.order_number
		   WHERE A.f_cancelled = 'N' AND B.f_cancelled = 'N' AND A.Finished = 1 AND A.IsExample = @IsExample
		   GROUP BY A.id, A.customer, A.order_number, 
			  A.order_date, A.ship_date, A.etd,
			  A.Finished, A.cust_po_number, A.[range],
			  A.create_by,
              A.IsExample, A.IsPhoi, A.IsUV, A.IsOutsource
		   ORDER BY A.order_date DESC
		END

		IF @Type = 'NOT'
		BEGIN
		   SELECT A.id, A.customer, A.order_number, 
			  A.order_date, A.ship_date, A.etd AS cont_date,
			  A.Finished, A.cust_po_number, A.[range],
			  SUM(B.order_qty) AS order_qty,
			  SUM(B.ship_qty) AS ship_qty,
			  SUM(B.order_qty * B.price) AS amount,
			  MAX(A.create_date) AS create_date,
			  A.create_by,
              A.IsExample, A.IsPhoi, A.IsUV, A.IsOutsource,
              IIF(A.IsExample=1, 'EXAMPLE', IIF(A.IsPhoi=1, 'PHOI', IIF(A.IsUV=1,'UV', IIF(A.IsOutsource=1,'GIACONG', 'SX')))) AS loaidonhang
		   FROM tr_order A
			  LEFT JOIN tr_order_detail B ON A.order_number = B.order_number
		   WHERE A.f_cancelled = 'N' AND B.f_cancelled = 'N' AND A.Finished = 0 AND A.IsExample = @IsExample
		   GROUP BY A.id, A.customer, A.order_number, 
			  A.order_date, A.ship_date, A.etd,
			  A.Finished, A.cust_po_number, A.[range],
			  A.create_by,
              A.IsExample, A.IsPhoi, A.IsUV, A.IsOutsource
		   ORDER BY A.order_date DESC
		END
	END
	ELSE IF @ViewType = 1
	BEGIN
		IF @Type = 'ALL'
		BEGIN
		   SELECT A.id, A.customer, A.order_number, 
			  A.order_date, A.ship_date, A.etd AS cont_date,
			  A.Finished, A.cust_po_number, A.[range],
			  SUM(B.order_qty) AS order_qty,
			  SUM(B.ship_qty) AS ship_qty,
			  SUM(B.order_qty * B.price) AS amount,
			  MAX(A.create_date),
			  A.create_by,
              A.IsExample, A.IsPhoi, A.IsUV, A.IsOutsource,
              IIF(A.IsExample=1, 'EXAMPLE', IIF(A.IsPhoi=1, 'PHOI', IIF(A.IsUV=1,'UV', IIF(A.IsOutsource=1,'GIACONG', 'SX')))) AS loaidonhang
		   FROM tr_order A
			  LEFT JOIN tr_order_detail B ON A.order_number = B.order_number
		   WHERE A.f_cancelled = 'N' AND B.f_cancelled = 'N' AND A.IsExample = @IsExample
				 AND A.order_date BETWEEN @FromDate AND @ToDate
		   GROUP BY A.id, A.customer, A.order_number, 
			  A.order_date, A.ship_date, A.etd,
			  A.Finished, A.cust_po_number, A.[range],
			  A.create_by,
              A.IsExample, A.IsPhoi, A.IsUV, A.IsOutsource
		   ORDER BY A.order_date DESC
		END

		IF @Type = 'FINISH'
		BEGIN
		   SELECT A.id, A.customer, A.order_number, 
			  A.order_date, A.ship_date, A.etd AS cont_date,
			  A.Finished, A.cust_po_number, A.[range],
			  SUM(B.order_qty) AS order_qty,
			  SUM(B.ship_qty) AS ship_qty,
			  SUM(B.order_qty * B.price) AS amount,
			  MAX(A.create_date) AS create_date,
			  A.create_by,
              A.IsExample, A.IsPhoi, A.IsUV, A.IsOutsource,
              IIF(A.IsExample=1, 'EXAMPLE', IIF(A.IsPhoi=1, 'PHOI', IIF(A.IsUV=1,'UV', IIF(A.IsOutsource=1,'GIACONG', 'SX')))) AS loaidonhang
		   FROM tr_order A
			  LEFT JOIN tr_order_detail B ON A.order_number = B.order_number
		   WHERE A.f_cancelled = 'N' AND B.f_cancelled = 'N' AND A.Finished = 1 AND A.IsExample = @IsExample
				 AND A.order_date BETWEEN @FromDate AND @ToDate
		   GROUP BY A.id, A.customer, A.order_number, 
			  A.order_date, A.ship_date, A.etd,
			  A.Finished, A.cust_po_number, A.[range],
			  A.create_by,
              A.IsExample, A.IsPhoi, A.IsUV, A.IsOutsource
		   ORDER BY A.order_date DESC
		END

		IF @Type = 'NOT'
		BEGIN
		   SELECT A.id, A.customer, A.order_number, 
			  A.order_date, A.ship_date, A.etd AS cont_date,
			  A.Finished, A.cust_po_number, A.[range],
			  SUM(B.order_qty) AS order_qty,
			  SUM(B.ship_qty) AS ship_qty,
			  SUM(B.order_qty * B.price) AS amount,
			  MAX(A.create_date) AS create_date,
			  A.create_by,
              A.IsExample, A.IsPhoi, A.IsUV, A.IsOutsource,
              IIF(A.IsExample=1, 'EXAMPLE', IIF(A.IsPhoi=1, 'PHOI', IIF(A.IsUV=1,'UV', IIF(A.IsOutsource=1,'GIACONG', 'SX')))) AS loaidonhang
		   FROM tr_order A
			  LEFT JOIN tr_order_detail B ON A.order_number = B.order_number
		   WHERE A.f_cancelled = 'N' AND B.f_cancelled = 'N' AND A.Finished = 0 AND A.IsExample = @IsExample
				 AND A.order_date BETWEEN @FromDate AND @ToDate
		   GROUP BY A.id, A.customer, A.order_number, 
			  A.order_date, A.ship_date, A.etd,
			  A.Finished, A.cust_po_number, A.[range],
			  A.create_by,
              A.IsExample, A.IsPhoi, A.IsUV, A.IsOutsource
		   ORDER BY A.order_date DESC
		END
	END
	
END
