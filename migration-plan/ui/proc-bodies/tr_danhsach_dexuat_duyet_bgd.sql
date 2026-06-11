-- PARAMS:
-- @nhom_dexuat nvarchar
-- @ma_dexuat nvarchar
-- @value_xetduyet nvarchar
-- @ngay_xetduyet datetime

CREATE PROC [dbo].[TR_DANHSACH_DEXUAT_DUYET_BGD]
(
  @nhom_dexuat NVARCHAR(50),
  @ma_dexuat nvarchar(50),
  @value_xetduyet nvarchar(50),
  @ngay_xetduyet datetime
)
AS
DECLARE @id_xetduyet int
SELECT @id_xetduyet = id 
FROM tr_nhom_xetduyet
WHERE isBGD = 1

IF @id_xetduyet IS NULL
  SET @id_xetduyet = 0
IF @id_xetduyet <> 0
BEGIN
  UPDATE tr_danhsach_dexuat
  SET vitri_xetduyet = @id_xetduyet,
    vitri_xetduyet_tieptheo = @id_xetduyet,
    trangthai_dexuat = 1,
	trangthai_dexuat2 = 'COMPLETE'
  WHERE nhom_dexuat = @nhom_dexuat AND ma_dexuat = @ma_dexuat
  
  UPDATE tr_danhsach_dexuat_process
  SET value_xetduyet = @value_xetduyet, ngay_xetduyet = @ngay_xetduyet
  WHERE nhom_dexuat = @nhom_dexuat AND ma_dexuat = @ma_dexuat
    AND id_xetduyet = @id_xetduyet
END

IF @nhom_dexuat = 'BANGMAU'
BEGIN
  UPDATE tr_dexuat_bangmau
  SET bangiamdoc_duyet = @value_xetduyet,
    bangiamdoc_ngayduyet = GETDATE()
  WHERE id = @ma_dexuat
END
ELSE IF @nhom_dexuat = 'DENGHITHANHTOAN'
BEGIN
  UPDATE tr_denghi_thanhtoan
  SET nguoiduyet = @value_xetduyet,
    ngayduyet = GETDATE()
  WHERE id = @ma_dexuat
END
ELSE IF @nhom_dexuat = 'DONDATHANG'
BEGIN
  UPDATE tr_dondathang
  SET nguoiky = @value_xetduyet,
    ngayky = GETDATE()
  WHERE maddh = @ma_dexuat
END
ELSE IF @nhom_dexuat = 'DONHANG'
BEGIN
  UPDATE tr_order
  SET bangiamdoc_duyet = @value_xetduyet, bangiamdoc_ngayduyet = GETDATE()
  WHERE order_number = @ma_dexuat
END
ELSE IF @nhom_dexuat = 'KYTHUAT'
BEGIN
  UPDATE tr_thaydoi_kythuat
  SET isconfirm3 = 1,
    ngayduyet3 = GETDATE(),
    bangiamdoc = @value_xetduyet
  WHERE id = @ma_dexuat
END
ELSE IF @nhom_dexuat = 'MUAHANG'
BEGIN
  UPDATE tr_phieuyeucau_muahang
  SET nguoiky = @value_xetduyet, ngayky = GETDATE()
  WHERE id = @ma_dexuat
END
ELSE IF @nhom_dexuat = 'MUAPHOI'
BEGIN
  UPDATE dqt_dexuat_phoi
  SET nguoiky = @value_xetduyet, ngayky = GETDATE()
  WHERE id = @ma_dexuat
END
ELSE IF @nhom_dexuat = 'XUATKHO'
BEGIN
  UPDATE tr_phieuyeucau
  SET nguoiky = @value_xetduyet, ngayky = GETDATE() 
  WHERE id = @ma_dexuat
END
