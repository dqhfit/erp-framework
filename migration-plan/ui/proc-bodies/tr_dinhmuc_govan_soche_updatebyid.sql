-- PARAMS:
-- @id uniqueidentifier
-- @masp nvarchar
-- @mact nvarchar
-- @stt nvarchar
-- @chitiet nvarchar
-- @nguyenlieu nvarchar
-- @dayy_sc decimal
-- @rong_sc decimal
-- @dai_sc decimal
-- @soluong_sc int
-- @m3_sc decimal
-- @ghichu nvarchar
-- @ngaytao datetime
-- @nguoitao nvarchar
-- @ngaysua datetime
-- @nguoisua nvarchar
-- @veneer_matchinh nvarchar
-- @veneer_matphu nvarchar
-- @veneer_dan_canh nvarchar
-- @uv_canhngan int
-- @uv_canhdai int
-- @uv_matchinh bit
-- @uv_matphu bit
-- @veneer_canhngan int
-- @veneer_canhdai int


CREATE PROC [dbo].[TR_DINHMUC_GOVAN_SOCHE_UPDATEBYID]
(
	@id uniqueidentifier,
	@masp nvarchar(200),
	@mact nvarchar(50),
	@stt nvarchar(20),
	@chitiet nvarchar(200),
	@nguyenlieu nvarchar(50),
	@dayy_sc decimal(18, 3),
	@rong_sc decimal(18, 3),
	@dai_sc decimal(18, 3),
	@soluong_sc int,
	@m3_sc decimal(18, 5),
	@ghichu nvarchar(200),
	@ngaytao datetime,
	@nguoitao nvarchar(50),
	@ngaysua datetime,
	@nguoisua nvarchar(50),
	@veneer_matchinh nvarchar(200) = null,
	@veneer_matphu nvarchar(200)= null,
    @veneer_dan_canh nvarchar(200)= null,
    @uv_canhngan int= null,
    @uv_canhdai int = null,
    @uv_matchinh bit = null,
    @uv_matphu bit = null,
	@veneer_canhngan int= null,
    @veneer_canhdai int = null
)
AS
UPDATE tr_dinhmuc_govan_soche
SET masp = @masp,
	mact = @mact,
	stt = @stt,
	chitiet = @chitiet,
	nguyenlieu = @nguyenlieu,
	dayy_sc = @dayy_sc,
	rong_sc = @rong_sc,
	dai_sc = @dai_sc,
	soluong_sc = @soluong_sc,
	m3_sc = @m3_sc,
	ghichu = @ghichu,
	ngaysua = @ngaysua, 
	nguoisua = @nguoisua,
	veneer_matchinh = @veneer_matchinh,
	veneer_matphu = @veneer_matphu,
	veneer_dan_canh = @veneer_dan_canh,
	uv_canhngan = @uv_canhngan,
	uv_canhdai = @uv_canhdai,
	uv_matchinh = @uv_matchinh,
	uv_matphu = @uv_matphu,
	veneer_canhngan = @veneer_canhngan,
	veneer_canhdai = @veneer_canhdai
WHERE id = @id
