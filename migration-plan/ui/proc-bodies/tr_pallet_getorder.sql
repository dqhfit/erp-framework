-- PARAMS:
-- (khong co tham so)


CREATE PROC TR_PALLET_GETORDER
AS
BEGIN
	SELECT B.order_number, B.[range] 
	FROM tr_pallet A
		INNER JOIN tr_order B ON A.donhang = B.order_number
	WHERE B.f_cancelled = 'N' AND B.Finished = 0 AND A.isOrderNumber = 1
	GROUP BY B.order_number, B.[range]
	ORDER BY 1
END

