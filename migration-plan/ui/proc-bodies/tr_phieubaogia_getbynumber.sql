-- PARAMS:
-- @SoPhieu nvarchar


CREATE PROC [dbo].[TR_PHIEUBAOGIA_GETBYNUMBER]
(
	@SoPhieu nvarchar(50)
)
AS
SELECT A.*, B.vendor_name AS TenKhachHang
FROM tr_phieubaogia A
	LEFT JOIN tr_nhacc B ON A.KhachHang = B.vendor_id
WHERE A.SoPhieu = @SoPhieu

