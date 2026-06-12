-- PARAMS:
-- @MaSP nvarchar
-- @PhanLoai nvarchar


CREATE PROC TR_BANVE_GET2
(
    @MaSP NVARCHAR(200),
    @PhanLoai NVARCHAR(50)
)
AS
SELECT *
FROM tr_banve WITH(NOLOCK)
WHERE active = 1
    AND masp = @MaSP
    AND phanloai = @PhanLoai

