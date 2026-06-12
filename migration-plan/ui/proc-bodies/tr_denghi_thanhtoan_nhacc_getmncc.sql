-- PARAMS:
-- @sophieu nvarchar

CREATE PROC [dbo].[TR_DENGHI_THANHTOAN_NHACC_GETMNCC]
(
	@sophieu nvarchar(300)
)
AS
BEGIN
	SELECT a.id,a.sophieu,b.mancc,b.tenncc FROM tr_denghi_thanhtoan a
	left join tr_dondathang b on a.chungtu = b.maddh
	where tenncc <> '' AND sophieu = @sophieu
END
