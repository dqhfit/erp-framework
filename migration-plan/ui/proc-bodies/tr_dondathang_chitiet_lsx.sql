-- PARAMS:
-- @dondathang nvarchar


CREATE   PROC [dbo].[TR_DONDATHANG_CHITIET_LSX](@dondathang nvarchar(200))
AS
BEGIN
	SELECT A.maddh, A.mancc, A.tenddh, A.ngaydat, A.ngaygiao,
		B.donhang, DH.cust_po_number, SP.masp_khachhang, 
		hinhanh = REPLACE(SP.hinhanh, 'wwwroot', 'https://dongquochung.com'),
		tenchitiet = COALESCE(SP.tensp_vn, B.tenchitiet),
		SP.masp_nhamay, SP.nguyenlieu, 
		--dbo.GetTenKhoaHoc(SP.nguyenlieu) AS tenkhoahoc,
		DH.tenkhoahoc,
		DH.fsc_100, DH.fsc_mix, DH.fsc_recycled,
		CASE
			WHEN DH.fsc_100 = 1 THEN N'FSC 100%'
			WHEN DH.fsc_mix = 1 THEN N'FSC Mix'
			WHEN DH.fsc_recycled = 1 THEN N'FSC Recycled'
			ELSE N'Non FSC'
		END AS tinhtrang_fsc,
		SP.mausac, SP.mauuv, SP.bemat_sanpham, B.soluong, SP.dvt,
		tong_m3 = B.soluong * SP.m3_tc,
		B.masp, B.chitiet, B.ghichu
	FROM tr_dondathang A
		INNER JOIN tr_dondathang_chitiet B ON A.maddh = B.maddh
		LEFT JOIN tr_sanpham SP ON B.masp = SP.masp
		LEFT JOIN tr_order_detail DH ON B.masp = DH.item_number AND B.donhang = DH.order_number
	WHERE A.active = 1 AND A.maddh = @dondathang
END

