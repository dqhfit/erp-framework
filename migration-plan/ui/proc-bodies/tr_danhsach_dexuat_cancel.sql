-- PARAMS:
-- @nhom_dexuat nvarchar
-- @ma_dexuat nvarchar

CREATE PROC TR_DANHSACH_DEXUAT_CANCEL(@nhom_dexuat nvarchar(50), @ma_dexuat nvarchar(50))
AS
UPDATE tr_danhsach_dexuat
SET trangthai_dexuat2 = 'CANCEL',
	trangthai_dexuat = 0
WHERE nhom_dexuat = @nhom_dexuat AND ma_dexuat = @ma_dexuat
