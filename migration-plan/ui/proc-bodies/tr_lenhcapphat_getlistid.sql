-- PARAMS:
-- @Active bit


CREATE PROC [dbo].[TR_LENHCAPPHAT_GetListID]
(
	@Active bit
)
AS
select distinct 
	CASE 
		WHEN LoaiDonHang ='DGO' THEN N'Bao bì' 
		WHEN LoaiDonHang ='GVA' THEN N'Gỗ ván' 
		WHEN LoaiDonHang ='NKI' THEN N'Ngũ kim' 
		WHEN LoaiDonHang ='SON' THEN N'Hóa chất' 
		WHEN LoaiDonHang ='HTR' THEN N'Hàng trắng' 
		WHEN LoaiDonHang ='VPH' THEN N'Văn phòng phẩm' 
		WHEN LoaiDonHang ='GWHS' THEN N'Thành phẩm' 
		WHEN LoaiDonHang ='AI' THEN N'AI' 
	END LoaiDonHang,
	LenhCapPhatID,
	CASE 
		WHEN LoaiCapPhat ='AFTER' THEN N'Sau Sơn' 
		WHEN LoaiCapPhat ='BEFORE' THEN N'Trước Sơn' 
		WHEN LoaiCapPhat ='GIACONG' THEN N'Gia công ngoài' 
		WHEN LoaiCapPhat ='SANXUAT' THEN N'Sản xuất' 
	END LoaiCapPhat,
	nguoitao,
	vuotdinhmuc,
	CAST(ngaytao AS DATE) ngaytao
from tr_lenhcapphat
where active = @Active
order by ngaytao desc
