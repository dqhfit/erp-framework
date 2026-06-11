-- PARAMS:
-- @MaDDH nvarchar


CREATE PROC TR_DONDATHANG_CANCEL(@MaDDH NVARCHAR(100))
AS

UPDATE tr_dondathang_chitiet
SET active = 0
WHERE maddh = @MaDDH

UPDATE tr_dondathang
SET trangthai = '-1',
    pheduyet = '-1',
    active = 0
WHERE maddh = @MaDDH
