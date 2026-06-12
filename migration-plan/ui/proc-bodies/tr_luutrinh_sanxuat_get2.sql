-- PARAMS:
-- @MaSP nvarchar
-- @MaCT nvarchar
-- @BoPhan nvarchar


CREATE PROC [dbo].[TR_LUUTRINH_SANXUAT_GET2]
(
	@MaSP nvarchar(200),
	@MaCT nvarchar(200),
	@BoPhan NVARCHAR(200) = ''
)
AS
BEGIN
	MERGE tr_luutrinh_sanxuat DS
	USING tr_quytrinh_sanxuat ST
	ON DS.id_rout = ST.id and DS.MaCT = @MaCT
	WHEN NOT MATCHED THEN
		INSERT 
		(
			Xuong, ToNhom,
			May, ThongTin, LuuY, 
			STT,
			MaSP, MaCT, 
			id_rout,
			active
		)
		VALUES
		(
			ST.BoPhan, ST.ToNhom,
			'', '', '', 
			ST.id,
			@MaSP, @MaCT, 
			ST.id,
			0
		);

	SELECT CAST(B.id AS NVARCHAR(20)) AS id
		, CAST(A.RoutID AS NVARCHAR(MAX)) AS RoutID
		, A.active, B.BoPhan, B.ToNhom, B.TenQuyTrinh
		, IIF(ISNULL(A.May, '') = '', B.MayMoc, A.May) AS May
		, A.ThongTin, A.LuuY
		, B.SoMay, B.SoNguoi, B.ThoiGian, B.SoLuong, B.SoTien
	FROM tr_luutrinh_sanxuat A
		RIGHT JOIN tr_quytrinh_sanxuat B
		ON A.id_rout = B.id
	WHERE A.MaCT = @MaCT 
		--AND b.BoPhan = @BoPhan
	ORDER BY CASE 
			WHEN B.BoPhan = N'Định Phôi' THEN 'A' 
			WHEN B.BoPhan = N'Định Hình' THEN 'B' 
		END
		, CASE
			 WHEN B.ToNhom = N'Tổ phôi' THEN 'A'
			 WHEN B.ToNhom = N'Nhám Máy' THEN 'B'
			 WHEN B.ToNhom = N'Cắt Tinh' THEN 'C'
			 WHEN B.ToNhom = N'Định Hình' THEN 'D'
			 WHEN B.ToNhom = N'Tổ Ván' THEN 'E'
		  END
		, A.STT, b.id
END

