-- PARAMS:
-- @MASP nvarchar
-- @SOLUONG int

CREATE PROC [dbo].[TR_DINHMUC_GOVAN_M3TOTAL]
(
	@MASP NVARCHAR(200),
	@SOLUONG INT = 1
)
AS
SELECT masp,nguyenlieu
	, SUM(m3_tc * @SOLUONG) m3_tc
	--, SUM(rong_tc * dai_tc * @SOLUONG)/1000000 m2_tc
FROM tr_dinhmuc_govan with(nolock)
WHERE masp = @MASP
    AND ISNULL(nguyenlieu, '') NOT IN ('', '0')
group by masp ,nguyenlieu
having SUM(m3_tc * @SOLUONG) > 0
order by nguyenlieu

