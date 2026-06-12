-- PARAMS:
-- @masp nvarchar
-- @mahtr nvarchar


CREATE PROC [dbo].[TR_DINHMUC_GOVAN_Get2] (@masp    NVARCHAR (MAX),
                                          @mahtr   NVARCHAR (MAX))
AS
--SELECT *
--FROM tr_dinhmuc_govan with(nolock)
--WHERE masp = @masp
--ORDER BY stt

SELECT id,
       @mahtr AS masp,
       mact,
       stt,
       chitiet,
       nguyenlieu,
       dayy_tc,
       rong_tc,
       dai_tc,
       soluong_tc,
       m3_tc,
       dayy_sc,
       rong_sc,
       dai_sc,
       m3_sc,
       dayy_phoi,
       ghichu,
       quytrinhgiacong,
       chatluong,
       bemat
FROM tr_dinhmuc_govan WITH (NOLOCK)
WHERE masp = @masp
--ORDER BY t_sort, stt
ORDER BY LEFT (stt, 1), REPLACE (stt, LEFT (stt, 1), '')
