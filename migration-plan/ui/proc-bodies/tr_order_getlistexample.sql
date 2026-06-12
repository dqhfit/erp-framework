-- PARAMS:
-- @Type nvarchar



CREATE PROC [dbo].[TR_ORDER_GETLISTEXAMPLE]
( 
	@Type nvarchar(50)
)
AS
BEGIN
    IF @Type = 'ALL'
    BEGIN
	   SELECT A.customer, A.order_number, 
		  A.order_date, A.ship_date, A.etd AS cont_date,
		  A.Finished, A.cust_po_number, A.[range],
		  SUM(B.order_qty) AS order_qty,
		  SUM(B.ship_qty) AS ship_qty
	   FROM tr_order A
		  INNER JOIN tr_order_detail B ON A.order_number = B.order_number
	   WHERE A.f_cancelled = 'N' AND B.f_cancelled = 'N' AND A.IsExample = 1
	   GROUP BY A.customer, A.order_number, 
		  A.order_date, A.ship_date, A.etd,
		  A.Finished, A.cust_po_number, A.[range]
	   ORDER BY A.order_date DESC
    END

    IF @Type = 'FINISH'
    BEGIN

	   SELECT A.customer, A.order_number, 
		  A.order_date, A.ship_date, A.etd AS cont_date,
		  A.Finished, A.cust_po_number, A.[range],
		  SUM(B.order_qty) AS order_qty,
		  SUM(B.ship_qty) AS ship_qty
	   FROM tr_order A
		  INNER JOIN tr_order_detail B ON A.order_number = B.order_number
	   WHERE A.f_cancelled = 'N' AND B.f_cancelled = 'N' AND A.Finished = 1 AND A.IsExample = 1
	   GROUP BY A.customer, A.order_number, 
		  A.order_date, A.ship_date, A.etd,
		  A.Finished, A.cust_po_number, A.[range]
	   ORDER BY A.order_date DESC
    END

    IF @Type = 'NOT'
    BEGIN
	   SELECT A.customer, A.order_number, 
		  A.order_date, A.ship_date, A.etd AS cont_date,
		  A.Finished, A.cust_po_number, A.[range],
		  SUM(B.order_qty) AS order_qty,
		  SUM(B.ship_qty) AS ship_qty
	   FROM tr_order A
		  INNER JOIN tr_order_detail B ON A.order_number = B.order_number
	   WHERE A.f_cancelled = 'N' AND B.f_cancelled = 'N' AND A.Finished = 0 AND A.IsExample = 1
	   GROUP BY A.customer, A.order_number, 
		  A.order_date, A.ship_date, A.etd,
		  A.Finished, A.cust_po_number, A.[range]
	   ORDER BY A.order_date DESC
    END
END

