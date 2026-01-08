"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { RangeCalendar } from "@/components/ui/calendar-rac"
import { Card, CardContent } from "@/components/ui/card"
import { ChevronDown } from "lucide-react"
import type { DateValue, RangeValue } from "react-aria-components"

interface DateRangePickerProps {
  value: RangeValue<DateValue> | null
  onChange: (value: RangeValue<DateValue> | null) => void
  label?: string
  placeholder?: string
}

export function DateRangePicker({
  value,
  onChange,
  label = "Date Range",
  placeholder = "Select dates",
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false)

  const formatDate = (date: DateValue | null) => {
    if (!date) return null
    return new Date(date.toString()).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const startText = value?.start ? formatDate(value.start) : null
  const endText = value?.end ? formatDate(value.end) : null
  const displayText =
    startText && endText ? `${startText} - ${endText}` : placeholder

  return (
    <div className="relative inline-block">
      {label && (
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          {label}
        </label>
      )}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs gap-1"
      >
        <span className="text-muted-foreground">{displayText}</span>
        <ChevronDown className="h-3 w-3 opacity-50" />
      </Button>

      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-1">
          <Card className="w-fit rounded-lg border border-border shadow-md">
            <CardContent className="p-3">
              <RangeCalendar
                value={value}
                onChange={(newValue) => {
                  onChange(newValue)
                  if (newValue?.start && newValue?.end) {
                    setIsOpen(false)
                  }
                }}
                className="rounded-lg border border-border p-2"
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
