# 课表接口调查

调查日期：2026-09-12。页面：`https://xspy.sii.edu.cn/educationalStudent/courseManage/courseInformation`。

公开静态资源：

- HTML 引用 `umi.9e4f5aec.js`、`config.js`。
- `config.js` 设置 `window.baseUrl = '/educationalAdministrationBackend'`。
- 课表 chunk：`p__CourseManage__CourseInformation__index.356d7f54.async.js`，模块 `77946`。
- HTTP 与 token helper：`712.0087acd5.async.js`，模块 `51690` 和 `33111`。

页面初始化只调用一次 `getTimetableDayPanel` 与 `getTimetableDayDataList`。切换周次只改变 React 状态，并以 `timetableDateMap[week]` 筛选已加载的课程。节次列表来自 `sectionList`；课程块按 `timetableDate` 和 `startSectionId` 放置，高度为 `sectionNumber × 50px`。因此整学期读取适合直接使用这两项接口，不需要翻 19 次页面。

页面显示字段：`className`、`classroomName`、`courseTeacherName`、`dataType`。其中 `1` 不显示状态标签，`2` 显示“调课”，其他值显示“停课”。程序额外对未知状态拒绝同步，不将任何任意新状态直接当成正常上课。

调课侧栏调用：

- `getTimetableDayAdjustmentClosedInfo`：`timetableStartDate` / `timetableEndDate`。
- `getTimetableWeekAdjustmentClosedInfo`：空对象。

日调整列表为 `timetableDayAdjustmentDataVOList`、`timetableDayClosedDataVOList`；学期调整列表为 `timetableWeekAdjustmentDataVOList`、`timetableWeekClosedDataVOList`。

HTTP helper 从本网站 `localStorage.token` 构造 `Authorization` 头，并将 POST body JSON 序列化。成功码是字符串 `00000`；`A0200` 表示登录异常。匿名请求实测返回 `A0200`。不使用未授权请求获取任何学生课程。

此前在用户已登录的 Chrome 页面观察到：2026-2027 学年、19 周；第 1 周为 2026-09-13 至 2026-09-19。页面未看到导出按钮。上述页面观察与公开代码仅说明接口契约；实际同步结果另由本地 `data/` 和验收记录证明。
