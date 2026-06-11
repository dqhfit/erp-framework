-- PARAMS:
-- @mamau nvarchar
-- @stt nvarchar
-- @buoc nvarchar
-- @mact nvarchar
-- @tenct nvarchar
-- @soluong decimal
-- @ngayquytrinh date
-- @nguoitao nvarchar
-- @ngaytao datetime
-- @nguoisua nvarchar
-- @ngaysua datetime
-- @dongia decimal
-- @thanhtien decimal
-- @t_sort int

CREATE PROC [dbo].[TR_DINHMUC_SON_THEOMAU_INSERT2] (@mamau          NVARCHAR (50),
                                            @stt            NVARCHAR (50),
                                            @buoc           NVARCHAR (MAX),
                                            @mact           NVARCHAR (200),
                                            @tenct          NVARCHAR (MAX),
                                            @soluong        DECIMAL (18, 5),
                                            @ngayquytrinh   DATE,
                                            @nguoitao       NVARCHAR (50),
                                            @ngaytao        DATETIME,
                                            @nguoisua       NVARCHAR (50),
                                            @ngaysua        DATETIME,
											@dongia decimal(18, 5) = 0,
											@thanhtien decimal(18, 5) = 0,
                                            @t_sort         INT)
AS
INSERT INTO tr_dinhmuc_son_theomau (mamau,
                                    stt,
                                    buoc,
                                    mact,
                                    tenct,
                                    soluong,
                                    ngayquytrinh,
                                    nguoitao,
                                    ngaytao,
                                    nguoisua,
                                    ngaysua,
									dongia, thanhtien,
                                    t_sort)
VALUES (@mamau,
        @stt,
        @buoc,
        @mact,
        @tenct,
        @soluong,
        @ngayquytrinh,
        @nguoitao,
        @ngaytao,
        @nguoisua,
        @ngaysua,
		@dongia, @thanhtien,
        @t_sort)
