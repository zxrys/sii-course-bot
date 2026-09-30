import { addDays } from '../src/schedule.js';

// Synthetic two-week fixture; contains no student identifiers or live credentials.
export function fixture() {
  return {
    fetchedAt: '2026-09-13T10:00:00.000Z', source: 'synthetic-test-fixture',
    panel: {
      schoolYear: '2026-2027', totalWeekNumber: 2, currentWeekSequence: 1, startWeekSequence: 1,
      sectionList: [
        { id: 's1', sectionSequence: 1, startTime: '08:00:00', endTime: '08:45:00' },
        { id: 's2', sectionSequence: 2, startTime: '08:55:00', endTime: '09:40:00' },
        { id: 's3', sectionSequence: 3, startTime: '09:50:00', endTime: '10:35:00' },
        { id: 's4', sectionSequence: 4, startTime: '10:45:00', endTime: '11:30:00' },
      ],
      timetableDateMap: Object.fromEntries([1, 2].map(week => [week, Array.from({ length: 7 }, (_, i) => ({ timetableDate: addDays('2026-09-13', (week - 1) * 7 + i) }))])),
    },
    courses: [{ timetableDate: '2026-09-14', startSectionId: 's2', endSectionId: 's4', sectionNumber: 3, className: '测试课程', classroomName: '201', courseTeacherName: '测试教师', dataType: '1' }],
    dayChanges: { timetableDayAdjustmentDataVOList: [], timetableDayClosedDataVOList: [] },
    termChanges: { timetableWeekAdjustmentDataVOList: [], timetableWeekClosedDataVOList: [] },
  };
}
