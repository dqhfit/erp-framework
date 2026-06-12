-- PARAMS:
-- (khong co tham so)


CREATE PROC [dbo].[TR_SANPHAM_GetNotOrder]
AS
BEGIN
    SELECT 
		 A.id
	    , A.masp
	    , A.masp_khachhang
	    , A.masp_nhamay
	    , A.tensp
	    , A.tensp_vn
	    , A.hehang
	    , A.mausac
	    , A.loaisp, B.tenloaisp
	    , A.ketcau
	    , A.bemat_sanpham
	    , A.ghichu
	    , A.dai
	    , A.rong
	    , A.cao
	    , A.kichthuoc
	    , A.nguyenlieu
	    , A.dvt
	    , A.quycach
	    , A.m2
	    , A.m3
	    , A.dai_carton
	    , A.rong_carton
	    , A.cao_carton
	    , A.quycach_carton
	    --, cbm
		, CAST(cbm AS DECIMAL(18, 2)) AS cbm
		, CAST(cbm * 35.315 AS DECIMAL(18, 2)) AS cuft
	    , dongia
	    , loaitien
	    , vendor
	    , customer
	    , C.customer_name
	    , dacdiem
	    , hinhanh
		 --hinhanh1,
	    , A.IsGoVan
	    , A.IsNguKim
	    , A.IsSon
	    , A.IsBaoBi
	    , A.IsHangTrang
	    , A.banve
	    , A.ngaybaogia, hanbaogia
	    , A.create_by
	    , A.create_date
	    , A.update_by
	    , A.update_date
	    , A.heso_mam
	    , A.dongia_mam
	    , null thumbnail
	    , A.carton_qty
	    , A.n_weight, g_weight
	    , A.mauuv
		, A.ma_btp
		, A.ma_erp, A.isCreatedCosting, A.m3_tc, A.oast_date
    FROM   tr_sanpham A WITH(NOLOCK)
		LEFT JOIN tr_loaisp B ON A.loaisp = B.maloaisp
		LEFT JOIN tr_khachhang C ON A.customer = C.customer_id
    WHERE A.active = 1   
		AND	ISNULL(tensp, '') <> ''
	   AND masp NOT IN (SELECT DISTINCT item_number FROM tr_order_detail WITH(NOLOCK) WHERE f_cancelled = 'N')
END
