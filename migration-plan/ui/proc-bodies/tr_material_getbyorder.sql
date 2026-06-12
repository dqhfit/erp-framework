-- PARAMS:
-- @KHO nvarchar
-- @DONHANG nvarchar


CREATE   PROC TR_MATERIAL_GETBYORDER
(
	@KHO NVARCHAR(50),
	@DONHANG NVARCHAR(MAX)
)
AS
BEGIN
	--SET @KHO = 'SON';
	--SET @DONHANG = 'VF-0004-4, VF-0005-1, VF-0005-3';

	SELECT b.item_number, SUM(b.order_qty) AS order_qty
	INTO #THONGTIN_DONHANG
	FROM tr_order A
		INNER JOIN tr_order_detail B ON A.order_number = B.order_number
	WHERE A.order_number IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@DONHANG, ','))
	GROUP BY b.item_number

	IF @KHO = 'NKI'
	BEGIN
		SELECT DISTINCT C.id, C.idxuong, C.mavt, C.mota, C.tenvt, C.quycach, C.mausac, C.dvt, C.dacdiem
		FROM tr_dinhmuc_ngukim A
			INNER JOIN #THONGTIN_DONHANG B ON A.masp = B.item_number
			INNER JOIN tr_material C ON A.mavt = C.mavt
	END
	ELSE IF @KHO = 'DGO'
	BEGIN
		SELECT DISTINCT C.id, C.idxuong, C.mavt, C.mota, C.tenvt, C.quycach, C.mausac, C.dvt, C.dacdiem
		FROM tr_dinhmuc_donggoi A
			INNER JOIN #THONGTIN_DONHANG B ON A.masp = B.item_number
			INNER JOIN tr_material C ON A.madonggoi = C.mavt
	END
	ELSE
	BEGIN
		DECLARE @tenkho nvarchar(50)
		SELECT @tenkho = [description] FROM tr_site WHERE [name] = @KHO

		SELECT A.*, B.soluong 
		FROM tr_material A WITH(NOLOCK)
			LEFT JOIN tr_tonkho_sum B ON A.mavt = B.mavt
		WHERE ISNULL(xoa, 'N') = 'N'
			AND (kho = @tenkho OR kho = N'VẬT TƯ KHÁC') 
			AND ISNULL(xacnhan,0) <> 0
			AND COALESCE(ngayhethan, '9999/12/31') > GETDATE()

	END

	DROP TABLE #THONGTIN_DONHANG;

END





