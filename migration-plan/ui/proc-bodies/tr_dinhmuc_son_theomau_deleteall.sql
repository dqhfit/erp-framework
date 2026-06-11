-- PARAMS:
-- @mamau nvarchar

CREATE PROC TR_DINHMUC_SON_THEOMAU_DELETEALL (@mamau NVARCHAR (50))
AS
DELETE tr_dinhmuc_son_theomau
WHERE mamau = @mamau
