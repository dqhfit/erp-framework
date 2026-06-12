-- PARAMS:
-- @loaiddh nvarchar


CREATE PROC [dbo].[TR_DONDATHANG_GetByWS]
( 
	@loaiddh nvarchar(50)
)
AS
BEGIN
	IF @loaiddh = 'VPH'
		SET @loaiddh = 'OTHER'
	
	SELECT  maddh, mancc, tenncc, 
		CASE
			WHEN loaiddh = 'NKI' THEN N'Ngũ Kim'
			WHEN loaiddh = 'DGO' THEN N'Bao Bì'
			WHEN loaiddh = 'SON' THEN N'Sơn'
			WHEN loaiddh = 'GVA' THEN N'Gỗ ván'
			WHEN loaiddh = 'HTR' THEN N'Hàng trắng'
			WHEN loaiddh = 'PHOI' THEN N'Phôi'
			WHEN loaiddh = 'OTHER' THEN N'Khác'
		 END AS loaiddh, 
		 CASE
			WHEN trangthai = '-1' THEN N'Hủy'
			WHEN trangthai = '0' THEN N'Đã tạo'
			WHEN trangthai = '1' THEN N'Đã duyệt'
			WHEN trangthai = '2' THEN N'Nhập một phần'
			WHEN trangthai = '3' THEN N'Đã nhập xong'
		END AS trangthai, 
		trangthai AS trangthai1,
		donhang,
		nguoiky, 
		ngayky
	FROM   tr_dondathang WITH(NOLOCK)
	WHERE  pheduyet = '1'
		 AND loaiddh IN( @loaiddh, 'OTHER' )
		 AND active = 1
	ORDER BY IIF(trangthai = -1, 9999, trangthai)
END
