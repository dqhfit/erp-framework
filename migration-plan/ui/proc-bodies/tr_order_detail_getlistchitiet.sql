-- PARAMS:
-- @order_number nvarchar
-- @isUV bit

CREATE   PROC [dbo].[TR_ORDER_DETAIL_GETLISTCHITIET]
(
	@order_number nvarchar(200),
	@isUV bit = 0
)
AS
BEGIN
	DECLARE @malo_nguyenlieu NVARCHAR(4000);
	EXEC DQT_THONGKE_PHOI_GETMALO @order_number, 2, @malo_nguyenlieu OUTPUT;

	IF @isUV = 0
	BEGIN
		SELECT CONCAT(B.stt, ' - ', B.chitiet) as tensp, B.masp, 
			IIF(B.soluong_tc = 0, 1, B.soluong_tc) * A.order_qty as order_qty, 
			B.nguyenlieu, 
			B.dayy_tc as dai, B.rong_tc as rong, B.dai_tc as cao,
			@malo_nguyenlieu AS malo_nguyenlieu
		FROM tr_order_detail A
			INNER JOIN tr_dinhmuc_govan B ON A.item_number = B.masp
		WHERE A.f_cancelled = 'N'
			AND A.order_number = @order_number
			AND LEN(B.stt) = 3
		ORDER BY B.masp
	END
	ELSE
	BEGIN
		SELECT CONCAT(B.stt, ' - ', B.chitiet) as tensp, B.masp, 
			IIF(B.soluong_tc = 0, 1, B.soluong_tc) * A.order_qty as order_qty, 
			B.nguyenlieu, 
			B.dayy_tc as dai, B.rong_tc as rong, B.dai_tc as cao,
			@malo_nguyenlieu AS malo_nguyenlieu
		FROM tr_order_detail A
			INNER JOIN tr_dinhmuc_govan B ON A.item_number = B.masp
		WHERE A.f_cancelled = 'N'
			AND A.order_number = @order_number
			--AND LEN(B.stt) = 3
			AND (B.uv_matchinh1 IS NOT NULL
				OR B.uv_matphu1 IS NOT NULL
				OR B.uv_canhdai1 IS NOT NULL
				OR B.uv_canhngan1 IS NOT NULL)
		ORDER BY B.masp		
	END
END


