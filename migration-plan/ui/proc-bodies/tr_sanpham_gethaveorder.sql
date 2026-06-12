-- PARAMS:
-- (khong co tham so)

CREATE PROC [dbo].[TR_SANPHAM_GetHaveOrder]
AS
BEGIN
SELECT A.id,
       A.masp,
       A.masp_khachhang,
       A.masp_nhamay,
       A.tensp,
       A.tensp_vn,
       A.hehang,
       A.mausac,
       A.mauuv,
       A.loaisp, B.tenloaisp,
       A.ketcau,
       A.bemat_sanpham,
       A.ghichu,
       A.dai,
       A.rong,
       A.cao,
       A.kichthuoc,
       A.nguyenlieu,
       A.dvt,
       A.quycach,
       A.m2,
       A.m3,
       A.dai_carton,
       A.rong_carton,
       A.cao_carton,
       A.quycach_carton,
       CAST (A.cbm AS DECIMAL (18, 2)) AS cbm,
       CAST (A.cbm * 35.315 AS DECIMAL (18, 2)) AS cuft,
       A.carton_qty,
       A.dongia,
       A.loaitien,
       A.vendor,
       A.customer,
       C.customer_name,
       A.dacdiem,
       A.hinhanh,
       NULL hinhanh1,
       NULL thumbnail,
       A.IsGoVan,
       A.IsNguKim,
       A.IsSon,
       A.IsBaoBi,
       A.IsHangTrang,
       A.banve,
       A.ngaybaogia,
       A.hanbaogia,
       A.create_by,
       A.create_date,
       A.update_by,
       A.update_date,
       NULL hinhanh2,
       A.heso_mam,
       A.dongia_mam,
       A.active,
       A.n_weight,
       A.g_weight,
       A.ThoiDiem,
       A.ma_btp,
       A.ma_erp,
	   A.isCreatedCosting,
	   A.m3_tc, A.oast_date
FROM tr_sanpham A 
	LEFT JOIN tr_loaisp B ON A.loaisp = B.maloaisp
	LEFT JOIN tr_khachhang C ON A.customer = C.customer_id
WHERE A.active = 1    
	   AND masp IN (SELECT DISTINCT item_number FROM tr_order_detail WITH(NOLOCK) WHERE f_cancelled = 'N')
	   AND ISNULL(tensp, '') <> ''
END
