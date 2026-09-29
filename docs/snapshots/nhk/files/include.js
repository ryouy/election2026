function writeHeader(selected) {
  $.ajax({
    url: '/senkyo-data/module/mod_header.html',
    cache: false,
    async: false,
  })
    .done(function (html) {
      function writeHtml() {
        var dfd = new $.Deferred();
        document.write(html);
        dfd.resolve();
        return dfd.promise();
      }
      writeHtml(selected).done(function () {
        createHeader(selected);
      });
    })
    .fail(function (e) {
      $('#wrapper').prepend('ヘッダーの読み込みに失敗しました。リロードをしてください');
    });
}

function writeModule(moduleUrl) {
  $.ajax({
    url: moduleUrl,
    cache: false,
    async: false,
  })
    .done(function (html) {
      document.write(html);
    })
    .fail(function (e) {
      console.log(e);
    });
}

function createHeader(selected) {
  const BREAK_POINT = 767;

  // パス名からページの階層を判定
  var URLFORHEADER = location.href;
  URLFORHEADER = URLFORHEADER.toLowerCase().split('/');
  var UNDERLAYER = false;

  $(function () {
    // トップページかそれ以外かの判定
    if (!('senkyo' == URLFORHEADER[URLFORHEADER.length - 2] || /^index.html/g.test(URLFORHEADER[URLFORHEADER.length - 1]))) {
      UNDERLAYER = true;
    }

    // トップページとそれ以外でのヘッダー表示切り替え
    if (UNDERLAYER) {
      $('#header').addClass('header-desc-none').addClass('under-layer');
      $('#header .under').css({ display: 'block' });
      $('#header .h1').css({ display: 'none' });
    } else {
      $('#header .under').css({ display: 'none' });
      $('#header .h1').css({ display: 'block' });
    }

    // PC/SP表示の初期設定
    var winWidth = $(window).innerWidth();
    var heightforheader, headerheight;

    // 画面幅に応じたメニュー切り替え
    if (winWidth > BREAK_POINT) {
      togglePcmenu();
    } else {
      toggleSpmenu();
    }

    // ヘッダー高さの設定
    heightforheader = $('#nhk-one-header').outerHeight();
    headerheight = $('#header').outerHeight();
    let total_headerHeight = heightforheader + headerheight;

    // スクロール時のヘッダー追従設定
    if (selected === 'follow') {
      var display_target = document.getElementsByClassName('disp');
      var ary = Array.prototype.slice.call(display_target);
      var target = document.getElementById('header');
      var nhkheaderheight = heightforheader;
      var height = headerheight;
      var offset = 0;
      var lastPosition = 0;
      var before = 0;
      var ticking = 0;
      var scroll_switch_flg = 0;

      window.addEventListener('scroll', function (e) {
        lastPosition = window.pageYOffset;
        onScroll(lastPosition);
      });
    }

    // PCメニューの制御
    function togglePcmenu() {
      // SPメニュー関連の要素を非表示に
      $('.gnav.sp-on').hide();
      $('.overlay.sp-on').hide();
      $('.gnav__btn.sp-on').hide();

      // PCメニュー関連の要素を表示
      $('.gnav.pc-on').show();

      function toggles(target_class) {
        $('.gnav.pc-on .' + target_class)
          .off()
          .hover(
            function () {
              if ($(this).find('.menu-toggle').css('display') === 'none') {
                $(this).find('.menu-toggle').slideDown(200);
              }
            },
            function () {
              $(this).find('.menu-toggle').slideUp(200);
            },
          );
      }

      toggles('yotei');
    }

    // SPメニューの制御
    function toggleSpmenu() {
      // PCメニューを非表示
      $('.gnav.pc-on').hide();

      // SPメニュー関連の要素を表示
      $('.gnav.sp-on').show();
      $('.gnav__btn.sp-on').show();

      // イベントハンドラのクリーンアップと再設定
      $('.gnav.sp-on .yotei').off();
      $('.gnav__btn.sp-on').off();
      $('.sp-on .gnav-inner__close, .overlay.sp-on').off();

      function sptoggles(target_class) {
        $('.gnav.sp-on .' + target_class).on('click', function () {
          $(this).next('.menu-toggle').slideToggle(200);
          $(this).toggleClass('active');
        });
      }

      sptoggles('yotei');

      let scrollPosition;
      $('.gnav__btn.sp-on').on('click', function () {
        $('.gnav.sp-on').css('padding-top', 20 + 'px');
        $('.gnav.sp-on, .overlay.sp-on').addClass('open');
        scrollPosition = $(window).scrollTop();
        $('body').css('position', 'fixed');
        $('body').css('top', -scrollPosition);
      });

      $('.sp-on .gnav-inner__close, .overlay.sp-on').on('click', function () {
        $('.gnav.sp-on').css('padding-top', '');
        $('.gnav.sp-on, .overlay.sp-on').removeClass('open');
        $('body').css('position', '');
        $('body').css('top', '');
        window.scrollTo(0, scrollPosition);
      });
    }

    // スクロール時の処理
    function onScroll(lastPosition) {
      if (lastPosition > total_headerHeight + 150) {
        if (ticking === 0) {
          headerheight = $('#header').outerHeight();
          $('#wrapper').css({ 'padding-top': headerheight + 'px' });
          $('#header')
            .addClass('scrolling')
            .css({
              position: 'absolute',
              top: '-' + total_headerHeight + 'px',
            });
        }
        ticking++;

        if (lastPosition > before) {
          if (scroll_switch_flg < 0) scroll_switch_flg = 0;
          if (scroll_switch_flg == 0) {
            $('.scrolling').css({ top: '-' + total_headerHeight + 'px' });
          }
          scroll_switch_flg++;
        } else {
          if (scroll_switch_flg > 0) scroll_switch_flg = 0;
          if (scroll_switch_flg == 0) {
            $('.scrolling').css({ position: 'fixed', top: 0 });
          }
          scroll_switch_flg--;
        }
        before = lastPosition;
      } else if (lastPosition < total_headerHeight) {
        $('#wrapper').css({ 'padding-top': 0 });
        $('#header').removeClass('scrolling').css({ position: 'relative' });
        ticking = 0;
      }
    }
  });
}

function writeHeaderNoNav() {
  $.ajax({
    url: '/senkyo-data/module/mod_header_nonav.html',
    cache: false,
    async: false,
  })
    .done(function (html) {
      function writeHtml() {
        var dfd = new $.Deferred();
        document.write(html);
        dfd.resolve();
        return dfd.promise();
      }
      writeHtml();
    })
    .fail(function (e) {
      $('#wrapper').prepend('ヘッダーの読み込みに失敗しました。リロードをしてください');
    });
}
