-- PARAMS:
-- @customer nvarchar


CREATE   PROC TR_ORDER_DETAIL_GETBYCUSTOMER_PIVOT (@customer nvarchar(50))
AS
BEGIN
	SELECT A.NAM, A.groupName, total, 
		A.T1, A.T2, A.T3, A.T4, A.T5, A.T6,
		A.T7, A.T8, A.T9, A.T10, A.T11, A.T12
	FROM (
		SELECT YEAR(order_date) AS NAM,
			groupName = N'Số lượng đơn',
			1 AS T_SORT,
			total = COUNT(order_number),
			T1 = COUNT(CASE WHEN MONTH(order_date) = 1 THEN order_number END),
			T2 = COUNT(CASE WHEN MONTH(order_date) = 2 THEN order_number END),
			T3 = COUNT(CASE WHEN MONTH(order_date) = 3 THEN order_number END),
			T4 = COUNT(CASE WHEN MONTH(order_date) = 4 THEN order_number END),
			T5 = COUNT(CASE WHEN MONTH(order_date) = 5 THEN order_number END),
			T6 = COUNT(CASE WHEN MONTH(order_date) = 6 THEN order_number END),
			T7 = COUNT(CASE WHEN MONTH(order_date) = 7 THEN order_number END),
			T8 = COUNT(CASE WHEN MONTH(order_date) = 8 THEN order_number END),
			T9 = COUNT(CASE WHEN MONTH(order_date) = 9 THEN order_number END),
			T10 = COUNT(CASE WHEN MONTH(order_date) = 10 THEN order_number END),
			T11 = COUNT(CASE WHEN MONTH(order_date) = 11 THEN order_number END),
			T12 = COUNT(CASE WHEN MONTH(order_date) = 12 THEN order_number END)
		FROM v_orders_summary
		WHERE customer = @customer
		GROUP BY YEAR(order_date)
		UNION ALL
		SELECT YEAR(order_date) AS NAM,
			groupName = N'Số sản phẩm',
			2 AS T_SORT,
			total = SUM(total_order_qty),
			T1 = SUM(CASE WHEN MONTH(order_date) = 1 THEN total_order_qty END),
			T2 = SUM(CASE WHEN MONTH(order_date) = 2 THEN total_order_qty END),
			T3 = SUM(CASE WHEN MONTH(order_date) = 3 THEN total_order_qty END),
			T4 = SUM(CASE WHEN MONTH(order_date) = 4 THEN total_order_qty END),
			T5 = SUM(CASE WHEN MONTH(order_date) = 5 THEN total_order_qty END),
			T6 = SUM(CASE WHEN MONTH(order_date) = 6 THEN total_order_qty END),
			T7 = SUM(CASE WHEN MONTH(order_date) = 7 THEN total_order_qty END),
			T8 = SUM(CASE WHEN MONTH(order_date) = 8 THEN total_order_qty END),
			T9 = SUM(CASE WHEN MONTH(order_date) = 9 THEN total_order_qty END),
			T10 = SUM(CASE WHEN MONTH(order_date) = 10 THEN total_order_qty END),
			T11 = SUM(CASE WHEN MONTH(order_date) = 11 THEN total_order_qty END),
			T12 = SUM(CASE WHEN MONTH(order_date) = 12 THEN total_order_qty END)
		FROM v_orders_summary
		WHERE customer = @customer
		GROUP BY YEAR(order_date)
		UNION ALL
		SELECT YEAR(order_date) AS NAM,
			groupName = N'Giá trị',
			3 AS T_SORT,
			total = SUM(total_amount),
			T1 = SUM(CASE WHEN MONTH(order_date) = 1 THEN total_amount END),
			T2 = SUM(CASE WHEN MONTH(order_date) = 2 THEN total_amount END),
			T3 = SUM(CASE WHEN MONTH(order_date) = 3 THEN total_amount END),
			T4 = SUM(CASE WHEN MONTH(order_date) = 4 THEN total_amount END),
			T5 = SUM(CASE WHEN MONTH(order_date) = 5 THEN total_amount END),
			T6 = SUM(CASE WHEN MONTH(order_date) = 6 THEN total_amount END),
			T7 = SUM(CASE WHEN MONTH(order_date) = 7 THEN total_amount END),
			T8 = SUM(CASE WHEN MONTH(order_date) = 8 THEN total_amount END),
			T9 = SUM(CASE WHEN MONTH(order_date) = 9 THEN total_amount END),
			T10 = SUM(CASE WHEN MONTH(order_date) = 10 THEN total_amount END),
			T11 = SUM(CASE WHEN MONTH(order_date) = 11 THEN total_amount END),
			T12 = SUM(CASE WHEN MONTH(order_date) = 12 THEN total_amount END)
		FROM v_orders_summary
		WHERE customer = @customer
		GROUP BY YEAR(order_date)
	) A
	ORDER BY A.NAM DESC, T_SORT
END

