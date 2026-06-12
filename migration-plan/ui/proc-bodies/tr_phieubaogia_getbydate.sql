-- PARAMS:
-- @TuNgay date
-- @DenNgay date


CREATE PROC [dbo].[TR_PHIEUBAOGIA_GETBYDATE]
(
	@TuNgay date,
	@DenNgay date
)
AS
SELECT A.*, B.vendor_name AS TenKhachHang
FROM tr_phieubaogia A
	LEFT JOIN tr_nhacc B ON A.KhachHang = B.vendor_id
WHERE Active = 1
	AND CAST(A.NgayTao AS DATE) BETWEEN @TuNgay AND @DenNgay

