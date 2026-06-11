-- PARAMS:
-- @nhom_dexuat nvarchar
-- @ma_dexuat nvarchar
-- @value_xetduyet nvarchar
-- @ngay_xetduyet datetime

CREATE PROC [dbo].[TR_DANHSACH_DEXUAT_DUYET]
(
  @nhom_dexuat NVARCHAR(50),
  @ma_dexuat nvarchar(50),
  @value_xetduyet nvarchar(50),
  @ngay_xetduyet datetime
)
AS

DECLARE @VITRI_HIENTAI INT
DECLARE @VITRI_TIEPTHEO INT
DECLARE @VITRI_KETTHUC INT

SELECT @VITRI_HIENTAI = vitri_xetduyet,
  @VITRI_TIEPTHEO = vitri_xetduyet_tieptheo,
  @VITRI_KETTHUC = vitri_xetduyet_ketthuc
FROM tr_danhsach_dexuat
WHERE nhom_dexuat = @nhom_dexuat
  AND ma_dexuat = @ma_dexuat
  


IF EXISTS (SELECT * FROM tr_danhsach_xetduyet_user WHERE username = @value_xetduyet AND id_nhom_xetduyet = @VITRI_HIENTAI)
BEGIN

  IF @VITRI_HIENTAI = @VITRI_KETTHUC
    BEGIN
      UPDATE tr_danhsach_dexuat
      SET trangthai_dexuat = 1, 
          trangthai_dexuat2 = 'COMPLETE'
      WHERE nhom_dexuat = @nhom_dexuat
        AND ma_dexuat = @ma_dexuat
        
      
    END
  ELSE
  BEGIN
    DECLARE @VITRI_TIEPTHEO1 INT
    SELECT @VITRI_TIEPTHEO1 = id_xetduyet_next FROM tr_quytrinh_xetduyet
    WHERE nhom_dexuat = @nhom_dexuat AND id_xetduyet = @VITRI_TIEPTHEO

    IF @VITRI_TIEPTHEO1 = 0
      SET @VITRI_TIEPTHEO1 = @VITRI_TIEPTHEO

    UPDATE tr_danhsach_dexuat
    SET vitri_xetduyet = @VITRI_TIEPTHEO,
      vitri_xetduyet_tieptheo = @VITRI_TIEPTHEO1,
  	  trangthai_dexuat2 = 'PROCESS'
    WHERE nhom_dexuat = @nhom_dexuat
      AND ma_dexuat = @ma_dexuat
  END
  
  UPDATE tr_danhsach_dexuat_process
  SET value_xetduyet = @value_xetduyet, ngay_xetduyet = @ngay_xetduyet
  WHERE nhom_dexuat = @nhom_dexuat
    AND ma_dexuat = @ma_dexuat
    AND id_xetduyet = @VITRI_HIENTAI
  
--  DECLARE @TEMP INT
--  SELECT @TEMP = IIF(vitri_xetduyet = vitri_xetduyet_ketthuc, 1, 0) 
--  FROM tr_danhsach_dexuat
--  WHERE nhom_dexuat = @nhom_dexuat AND ma_dexuat = @ma_dexuat
--  
--  IF @TEMP = 1
--  BEGIN
--    DECLARE @VALUE NVARCHAR(50)
--    SELECT @VALUE = value_xetduyet FROM tr_danhsach_dexuat_process
--    WHERE nhom_dexuat = @nhom_dexuat AND ma_dexuat = @ma_dexuat AND id_xetduyet = @VITRI_TIEPTHEO
--    
--    IF LEN(@VALUE) > 0
--    BEGIN
--      UPDATE tr_danhsach_dexuat
--      SET trangthai_dexuat = 1, 
--          trangthai_dexuat2 = 'COMPLETE'
--      WHERE nhom_dexuat = @nhom_dexuat
--        AND ma_dexuat = @ma_dexuat
--    END
--  
--  END
  
END
