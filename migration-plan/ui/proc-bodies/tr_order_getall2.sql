-- PARAMS:
-- (khong co tham so)


CREATE   PROC [dbo].[TR_ORDER_GETALL2]
AS
BEGIN
	SELECT A.id, A.customer, B.customer_name, A.cust_po_number, A.order_number, A.[range], A.fsc_id,
		A.ncc_phoi, A.ncc_dinhhinh, A.ncc_son,
		A.cont_qty,
		A.order_date, 
		A.ship_date,
		COALESCE(A.target_date, A.ship_date) AS target_date, 
		A.actual_date, 
		A.kehoach_hangtrang,
		ngaychenhlech = CASE WHEN A.actual_date IS NOT NULL AND A.target_date IS NOT NULL THEN DATEDIFF(DAY, A.actual_date, A.target_date) END,
		A.remark, A.remark2,
		A.danhgia, A.trangthai_donhang,
		COALESCE(A.SortOrder, A.id) as SortOrder
	FROM tr_order A
	LEFT JOIN tr_khachhang B ON A.customer = B.customer_id
	WHERE A.Finished = 0 AND A.f_cancelled = 'N'
		AND A.IsExample = 0
	ORDER BY COALESCE(A.SortOrder, A.id)
END

