-- PARAMS:
-- (khong co tham so)

CREATE PROC [dbo].[TR_TONKHO_THANHPHAM_GetAll]
AS
BEGIN
	SELECT A.*, B.masp_khachhang, B.hehang, B.tensp, B.tensp_vn, B.carton_qty AS sothung_carton
	FROM tr_tonkho_thanhpham A
		INNER JOIN tr_sanpham B ON A.product_code = B.masp
		INNER JOIN tr_order C ON A.order_number = C.order_number
	WHERE C.f_cancelled = 'N' AND C.Finished = 0
	ORDER BY A.order_number
--select a.*, b.masp_khachhang
--from tr_tonkho_thanhpham a with(nolock), tr_sanpham b
--where a.product_code = b.masp
--    --and quantity <> 0
--order by order_number
END



