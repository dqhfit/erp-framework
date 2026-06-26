-- PARAMS:
-- @bomType nvarchar
-- @fromProduct nvarchar
-- @toProduct nvarchar
-- @ngaytao datetime
-- @nguoitao nvarchar
-- @ngaysua datetime
-- @nguoisua nvarchar

CREATE PROC MES_DINHMUC_COPY
(
	@bomType nvarchar(10),
	@fromProduct nvarchar(200),
	@toProduct nvarchar(200),
	@ngaytao datetime,
	@nguoitao nvarchar(50),
	@ngaysua datetime,
	@nguoisua nvarchar(50)
)
AS
BEGIN
	IF @bomType = 'GVA'
	BEGIN
		EXEC MES_DINHMUC_GOVAN_COPY @fromProduct, @toProduct, @ngaytao, @nguoitao, @ngaysua, @nguoisua
	END
	ELSE IF @bomType = 'NKI'
	BEGIN
		EXEC MES_DINHMUC_NGUKIM_COPY @fromProduct, @toProduct, @ngaytao, @nguoitao, @ngaysua, @nguoisua
	END
	ELSE IF @bomType = 'DGO'
	BEGIN
		EXEC MES_DINHMUC_DONGGOI_COPY @fromProduct, @toProduct, @ngaytao, @nguoitao, @ngaysua, @nguoisua
	END
	ELSE IF @bomType = 'VENEER'
	BEGIN
		EXEC MES_DINHMUC_VENEER_COPY @fromProduct, @toProduct, @ngaytao, @nguoitao, @ngaysua, @nguoisua
	END
END
