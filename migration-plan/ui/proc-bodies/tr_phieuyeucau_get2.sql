-- PARAMS:
-- @SoPhieu int


CREATE   PROC [dbo].[TR_PHIEUYEUCAU_GET2]
(
    @SoPhieu int
)
AS
BEGIN
    -- Table0: Thông tin phiếu yêu cầu
    SELECT A.id, A.sophieu, A.ngaytao, B.tendexuat AS loaidexuat, COALESCE(C.FullName, A.nguoitao) AS nguoitao,
        COALESCE(A.donhangtrang, A.donhang) AS donhang, A.mucdich
    FROM tr_phieuyeucau A
        LEFT JOIN tr_loai_dexuat B ON A.loaidexuat = B.madexuat
        LEFT JOIN SYS_USER C ON A.nguoitao = C.UserName
    WHERE A.sophieu = @SoPhieu

    -- Table1: Chi tiết vật tư trong phiếu yêu cầu
    SELECT B.mact, C.mota, C.quycach, C.mausac, C.dvt, B.soluong, B.ghichu
    FROM tr_phieuyeucau A
    INNER JOIN tr_phieuyeucau_chitiet B ON A.id = B.phieuyeucau_id
    INNER JOIN tr_material C ON B.mact = C.mavt
    WHERE A.sophieu = @SoPhieu
END

