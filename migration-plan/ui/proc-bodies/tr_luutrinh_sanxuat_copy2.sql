-- PARAMS:
-- @MaSP1 nvarchar
-- @MaCT1 nvarchar
-- @MaSP2 nvarchar
-- @MaCT2 nvarchar


CREATE PROC TR_LUUTRINH_SANXUAT_COPY2
(
    @MaSP1 NVARCHAR(200),
    @MaCT1 NVARCHAR(50),
    @MaSP2 NVARCHAR(200),
    @MaCT2 NVARCHAR(50)
)
AS

DELETE tr_luutrinh_sanxuat
WHERE MaSP = @MaSP2 AND MaCT = @MaCT2

INSERT INTO tr_luutrinh_sanxuat
(
    STT, Xuong, ToNhom,
    May, ThongTin, LuuY, LanUV,
    SoMat, SoCanh, SoDau,
    MaSP, MaCT, id_rout, active
)
SELECT STT, Xuong, ToNhom
    , May, ThongTin, LuuY, LanUV
    , SoMat, SoCanh, SoDau
    , @MaSP2 AS MaSP, @MaCT2 AS MaCT
    , id_rout, active
FROM tr_luutrinh_sanxuat
WHERE MaSP = @MaSP1 AND MaCT = @MaCT1


