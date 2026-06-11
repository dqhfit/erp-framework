-- PARAMS:
-- @CODE nvarchar


CREATE PROC [dbo].[UPDATEMATERIALCODE](@CODE NVARCHAR(200))
AS

DECLARE @TENVT NVARCHAR(MAX);
DECLARE @MOTA NVARCHAR(MAX);
DECLARE @QUYCACH NVARCHAR(200);
DECLARE @DVT NVARCHAR(50);
DECLARE @NHOM NVARCHAR(200);
DECLARE @MAUSAC NVARCHAR(200);

SELECT @TENVT = tenvt
	, @MOTA = mota
	, @QUYCACH = quycach
	, @DVT = dvt
	, @NHOM = nhom
	, @MAUSAC = mausac
FROM tr_material WITH(NOLOCK)
WHERE idxuong = @CODE;

UPDATE tr_dinhmuc_donggoi
SET chitiet = @MOTA,
	quycach = @QUYCACH,
	dvt = @DVT
WHERE madonggoi = @CODE;


UPDATE tr_dinhmuc_ngukim
SET chitiet = @MOTA,
	quycach = @QUYCACH,
	dvt = @DVT,
	nhom = @NHOM
WHERE mavt = @CODE;


UPDATE tr_dinhmuc_son
SET tenct = @MOTA,
	nhom = @NHOM,
	dvt = @DVT
WHERE mact = @CODE;


UPDATE tr_dondathang_chitiet
SET tenchitiet = @MOTA,
	dvt = @DVT
WHERE chitiet = @CODE;


UPDATE tr_lenhcapphat
SET mota = @MOTA,
	dvt = @DVT,
	quycach = @QUYCACH,
	mausac = @MAUSAC,
	nhom = @NHOM
WHERE mavt = @CODE;




