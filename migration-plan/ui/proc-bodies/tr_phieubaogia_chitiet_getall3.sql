-- PARAMS:
-- (khong co tham so)


CREATE PROC [dbo].[TR_PHIEUBAOGIA_CHITIET_GETALL3]
AS
BEGIN
	SELECT A.SoPhieu, A.TieuDe, A.ghichu,
		B.MaCT, B.TenCT, B.QuyCach, B.MauSac, B.DVT, 
		B.DonGiaCu, B.DonGiaMoi, B.LoaiTien,
		B.mancc, C.vendor_name, 
		B.ghichu AS ghichu1,
		B.NguoiDuyet, E.FullName AS TenNguoiDuyet, B.NgayDuyet, 
		b.IsNotDuyet, B.LyDoKhongDuyet,
		A.NguoiTao, D.FullName AS TenNguoiTao, A.NgayTao,
		phantram = ROUND(((B.DonGiaMoi - B.DonGiaCu)/ NULLIF(B.DonGiaCu, 0)) * 100, 2)
	FROM tr_phieubaogia A
		INNER JOIN tr_phieubaogia_chitiet B ON A.SoPhieu = B.SoPhieu
		LEFT JOIN tr_nhacc C ON B.mancc = C.vendor_id
		LEFT JOIN SYS_USER D ON A.NguoiTao = D.UserName
		LEFT JOIN SYS_USER E ON B.NguoiDuyet = E.UserName
	WHERE B.Active = 1 AND A.Active = 1
END


