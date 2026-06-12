-- PARAMS:
-- (khong co tham so)


CREATE PROC [dbo].[TR_NHAP_THANHPHAM_ByCurrentDate]
AS
SELECT *
  FROM tr_nhap_thanhpham
WHERE CAST(ngaytao AS DATE) = CAST(GETDATE() AS DATE)
ORDER BY ngaytao DESC
