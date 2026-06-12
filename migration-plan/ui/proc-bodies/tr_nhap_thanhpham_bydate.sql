-- PARAMS:
-- @Date date


CREATE PROC [dbo].[TR_NHAP_THANHPHAM_ByDate] (@Date Date)
AS
SELECT madonhang,
       madonhang_khachhang,
       masp,
       tensp,
       hehang,
       dvt,
       SUM(soluong) soluong,
       ghichu, ghichu2,
       CAST(ngaytao AS DATE) AS ngaytao
  FROM tr_nhap_thanhpham
WHERE CAST(ngaytao AS DATE) = CAST(@Date AS DATE)
GROUP BY madonhang,
       madonhang_khachhang,
       masp,
       tensp,
       hehang,
       dvt, ghichu, ghichu2, CAST(ngaytao AS DATE)

